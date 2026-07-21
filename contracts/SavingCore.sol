// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./VaultManager.sol";

/// @title SavingCore
/// @notice Hợp đồng chính của hệ thống — quản lý plans, deposits, NFTs và renewals
/// @dev Kế thừa ERC721 (mỗi deposit = 1 NFT), ERC721Enumerable, Ownable, Pausable, ReentrancyGuard
contract SavingCore is ERC721, ERC721Enumerable, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Token ERC-20 dùng cho deposits (MockUSDC)
    IERC20 public immutable token;

    /// @notice VaultManager — nơi giữ tiền lãi và phí phạt
    VaultManager public immutable vaultManager;

    // ──────────────────────────── Enums ────────────────────────────

    /// @notice Trạng thái của một khoản deposit
    enum DepositStatus {
        Active,        // Đang hoạt động, chờ đáo hạn
        Withdrawn,     // Đã rút tiền khi đáo hạn
        EarlyWithdrawn,// Đã rút sớm (bị phạt)
        ManualRenewed, // Đã gia hạn thủ công
        AutoRenewed    // Đã tự động gia hạn
    }

    // ──────────────────────────── Structs ────────────────────────────

    /// @notice Cấu trúc plan tiết kiệm
    struct Plan {
        uint256 tenorDays;                // Số ngày kỳ hạn
        uint256 aprBps;                   // Lãi suất năm (bps)
        uint256 minDeposit;               // Số tiền gửi tối thiểu
        uint256 maxDeposit;               // Số tiền gửi tối đa
        uint256 earlyWithdrawPenaltyBps;  // Phí phạt rút sớm (bps)
        bool enabled;                     // Plan có đang hoạt động không
    }

    /// @notice Cấu trúc khoản deposit (được mã hóa thành NFT)
    struct Deposit {
        uint256 planId;            // ID plan liên kết
        uint256 principal;         // Số tiền gửi gốc
        uint256 startAt;           // Thời điểm mở (block timestamp)
        uint256 maturityAt;        // Thời điểm đáo hạn
        uint256 aprBpsAtOpen;      // APR tại thời điểm mở (snapshot)
        uint256 penaltyBpsAtOpen;  // Phí phạt tại thời điểm mở (snapshot)
        DepositStatus status;      // Trạng thái hiện tại
    }

    // ──────────────────────────── State ────────────────────────────

    /// @notice Danh sách tất cả plans
    Plan[] public plans;

    /// @notice Mapping từ depositId đến thông tin deposit
    mapping(uint256 => Deposit) public deposits;

    /// @notice ID tiếp theo sẽ mint cho deposit mới
    uint256 public nextDepositId;

    // ──────────────────────────── Events ────────────────────────────

    /// @notice Bắn khi tạo plan mới
    event PlanCreated(uint256 indexed planId, uint256 tenorDays, uint256 aprBps);

    /// @notice Bắn khi cập nhật plan
    event PlanUpdated(uint256 indexed planId);

    /// @notice Bắn khi bật plan
    event PlanEnabled(uint256 indexed planId);

    /// @notice Bắt khi tắt plan
    event PlanDisabled(uint256 indexed planId);

    /// @notice Bắn khi mở deposit mới
    event DepositOpened(uint256 indexed depositId, address indexed owner, uint256 planId, uint256 amount);

    /// @notice Bắn khi rút tiền (đúng hạn hoặc rút sớm)
    event Withdrawn(uint256 indexed depositId, address indexed to, uint256 principal, uint256 interest, bool isEarly);

    // ──────────────────────────── Constructor ────────────────────────────

    /// @notice Khởi tạo SavingCore
    /// @param _token Địa chỉ token ERC-20 (MockUSDC)
    /// @param _vaultManager Địa chỉ VaultManager
    constructor(address _token, address _vaultManager)
        ERC721("Saving Certificate", "SCERT")
        Ownable(msg.sender)
    {
        require(_token != address(0), "SavingCore: zero address");
        require(_vaultManager != address(0), "SavingCore: zero address");
        token = IERC20(_token);
        vaultManager = VaultManager(_vaultManager);
    }

    // ──────────────────────────── Admin Functions ────────────────────────────

    /// @notice Tạo plan tiết kiệm mới
    /// @dev Chỉ owner mới gọi được
    /// @param _tenorDays Số ngày kỳ hạn (phải > 0)
    /// @param _aprBps Lãi suất năm theo bps (1-10000)
    /// @param _minDeposit Số tiền gửi tối thiểu
    /// @param _maxDeposit Số tiền gửi tối đa (phải >= minDeposit)
    /// @param _earlyWithdrawPenaltyBps Phí phạt rút sớm theo bps
    function createPlan(
        uint256 _tenorDays,
        uint256 _aprBps,
        uint256 _minDeposit,
        uint256 _maxDeposit,
        uint256 _earlyWithdrawPenaltyBps
    ) external onlyOwner {
        require(_tenorDays > 0, "SavingCore: tenor must be > 0");
        require(_aprBps > 0 && _aprBps <= 10000, "SavingCore: invalid APR");
        require(_minDeposit > 0, "SavingCore: min must be > 0");
        require(_maxDeposit >= _minDeposit, "SavingCore: max < min");
        require(_earlyWithdrawPenaltyBps <= 10000, "SavingCore: invalid penalty");

        plans.push(Plan({
            tenorDays: _tenorDays,
            aprBps: _aprBps,
            minDeposit: _minDeposit,
            maxDeposit: _maxDeposit,
            earlyWithdrawPenaltyBps: _earlyWithdrawPenaltyBps,
            enabled: true
        }));

        emit PlanCreated(plans.length - 1, _tenorDays, _aprBps);
    }

    /// @notice Cập nhật plan tiết kiệm
    /// @dev Chỉ owner mới gọi được
    /// @param _planId ID plan cần cập nhật
    /// @param _tenorDays Số ngày kỳ hạn mới
    /// @param _aprBps Lãi suất năm mới (bps)
    /// @param _minDeposit Số tiền gửi tối thiểu mới
    /// @param _maxDeposit Số tiền gửi tối đa mới
    /// @param _earlyWithdrawPenaltyBps Phí phạt rút sớm mới
    function updatePlan(
        uint256 _planId,
        uint256 _tenorDays,
        uint256 _aprBps,
        uint256 _minDeposit,
        uint256 _maxDeposit,
        uint256 _earlyWithdrawPenaltyBps
    ) external onlyOwner {
        require(_planId < plans.length, "SavingCore: invalid plan");
        require(_tenorDays > 0, "SavingCore: tenor must be > 0");
        require(_aprBps > 0 && _aprBps <= 10000, "SavingCore: invalid APR");
        require(_minDeposit > 0, "SavingCore: min must be > 0");
        require(_maxDeposit >= _minDeposit, "SavingCore: max < min");
        require(_earlyWithdrawPenaltyBps <= 10000, "SavingCore: invalid penalty");

        Plan storage plan = plans[_planId];
        plan.tenorDays = _tenorDays;
        plan.aprBps = _aprBps;
        plan.minDeposit = _minDeposit;
        plan.maxDeposit = _maxDeposit;
        plan.earlyWithdrawPenaltyBps = _earlyWithdrawPenaltyBps;

        emit PlanUpdated(_planId);
    }

    /// @notice Bật plan tiết kiệm
    /// @dev Chỉ owner mới gọi được
    /// @param _planId ID plan cần bật
    function enablePlan(uint256 _planId) external onlyOwner {
        require(_planId < plans.length, "SavingCore: invalid plan");
        plans[_planId].enabled = true;
        emit PlanEnabled(_planId);
    }

    /// @notice Tắt plan tiết kiệm
    /// @dev Chỉ owner mới gọi được. Deposits đang Active vẫn giữ nguyên.
    /// @param _planId ID plan cần tắt
    function disablePlan(uint256 _planId) external onlyOwner {
        require(_planId < plans.length, "SavingCore: invalid plan");
        plans[_planId].enabled = false;
        emit PlanDisabled(_planId);
    }

    // ──────────────────────────── View Functions ────────────────────────────

    /// @notice Lấy số lượng plans hiện có
    /// @return uint256 số plans
    function planCount() external view returns (uint256) {
        return plans.length;
    }

    /// @notice Lấy thông tin plan theo ID
    /// @param _planId ID plan cần xem
    /// @return Plan struct chứa thông tin plan
    function getPlan(uint256 _planId) external view returns (Plan memory) {
        require(_planId < plans.length, "SavingCore: invalid plan");
        return plans[_planId];
    }

    // ──────────────────────────── User Functions ────────────────────────────

    /// @notice Mở khoản tiết kiệm mới
    /// @dev Phải approve token cho SavingCore trước khi gọi
    /// @param _planId ID plan muốn gửi
    /// @param _amount Số tiền gửi (phải trong khoảng min/max của plan)
    function openDeposit(uint256 _planId, uint256 _amount) external whenNotPaused nonReentrant {
        require(_planId < plans.length, "SavingCore: invalid plan");
        Plan storage plan = plans[_planId];
        require(plan.enabled, "SavingCore: plan disabled");
        require(_amount >= plan.minDeposit && _amount <= plan.maxDeposit, "SavingCore: amount out of range");

        // Chuyển token từ user vào SavingCore
        token.safeTransferFrom(msg.sender, address(this), _amount);

        // Tạo deposit mới
        uint256 depositId = nextDepositId++;
        uint256 maturityAt = block.timestamp + (plan.tenorDays * 86400);

        deposits[depositId] = Deposit({
            planId: _planId,
            principal: _amount,
            startAt: block.timestamp,
            maturityAt: maturityAt,
            aprBpsAtOpen: plan.aprBps,
            penaltyBpsAtOpen: plan.earlyWithdrawPenaltyBps,
            status: DepositStatus.Active
        });

        // Mint NFT cho user
        _mint(msg.sender, depositId);

        emit DepositOpened(depositId, msg.sender, _planId, _amount);
    }

    /// @notice Rút tiền khi đáo hạn
    /// @dev Chỉ chủ NFT mới gọi được. Tính lãi đơn và trả gốc + lãi.
    /// @param _depositId ID deposit cần rút
    function withdrawAtMaturity(uint256 _depositId) external whenNotPaused nonReentrant {
        require(_depositId < nextDepositId, "SavingCore: invalid deposit");
        Deposit storage dep = deposits[_depositId];
        require(dep.status == DepositStatus.Active, "SavingCore: not active");
        require(ownerOf(_depositId) == msg.sender, "SavingCore: not owner");
        require(block.timestamp >= dep.maturityAt, "SavingCore: not matured");

        // Tính lãi đơn: (gốc × aprBps × tenorSeconds) / (365 ngày × 10000)
        uint256 interest = (dep.principal * dep.aprBpsAtOpen * (dep.maturityAt - dep.startAt))
            / (365 days * 10000);

        // Cập nhật trạng thái
        dep.status = DepositStatus.Withdrawn;

        // Trả gốc từ SavingCore
        token.safeTransfer(msg.sender, dep.principal);

        // Trả lãi từ VaultManager
        vaultManager.payInterest(msg.sender, interest);

        emit Withdrawn(_depositId, msg.sender, dep.principal, interest, false);
    }

    // ──────────────────────────── ERC721Enumerable Overrides ────────────────────────────

    /// @dev Override để resolve conflict giữa ERC721 và ERC721Enumerable
    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Enumerable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    /// @dev Override để resolve conflict giữa ERC721 và ERC721Enumerable
    function _increaseBalance(address account, uint128 value)
        internal
        override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }

    /// @dev Override để resolve conflict giữa ERC721 và ERC721Enumerable
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
