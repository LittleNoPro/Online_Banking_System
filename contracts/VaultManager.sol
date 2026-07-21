// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title VaultManager
/// @notice Quản lý kho tiền của protocol — giữ token, phân phối lãi và phí phạt
/// @dev Chỉ SavingCore mới gọi được payInterest và payPenalty
contract VaultManager is Ownable, Pausable {
    using SafeERC20 for IERC20;

    /// @notice Token ERC-20 mà vault quản lý (MockUSDC)
    IERC20 public immutable token;

    /// @notice Địa chỉ nhận phí phạt rút sớm
    address public feeReceiver;

    /// @notice Địa chỉ SavingCore — chỉ hợp đồng này mới gọi được payInterest/payPenalty
    address public coreAddress;

    // ──────────────────────────── Events ────────────────────────────

    /// @notice Bắn khi feeReceiver thay đổi
    event FeeReceiverUpdated(address indexed newReceiver);

    /// @notice Bắn khi coreAddress thay đổi
    event CoreAddressUpdated(address indexed newCore);

    /// @notice Bắn khi có người nạp token vào vault
    event Funded(address indexed funder, uint256 amount);

    /// @notice Bắn khi owner rút token khỏi vault
    event Withdrawn(address indexed to, uint256 amount);

    /// @notice Bắn khi trả lãi cho user
    event InterestPaid(address indexed to, uint256 amount);

    // ──────────────────────────── Modifiers ────────────────────────────

    /// @dev Chỉ cho phép coreAddress (SavingCore) gọi
    modifier onlyCore() {
        require(msg.sender == coreAddress, "VaultManager: caller is not the core");
        _;
    }

    // ──────────────────────────── Constructor ────────────────────────────

    /// @notice Khởi tạo VaultManager
    /// @param _token Địa chỉ token ERC-20 (MockUSDC)
    /// @param _feeReceiver Địa chỉ nhận phí phạt rút sớm
    constructor(address _token, address _feeReceiver) Ownable(msg.sender) {
        require(_token != address(0), "VaultManager: zero address");
        require(_feeReceiver != address(0), "VaultManager: zero address");
        token = IERC20(_token);
        feeReceiver = _feeReceiver;
    }

    // ──────────────────────────── Admin Functions ────────────────────────────

    /// @notice Thay đổi địa chỉ nhận phí phạt
    /// @dev Chỉ owner mới gọi được
    /// @param _feeReceiver Địa chỉ mới nhận phí phạt
    function setFeeReceiver(address _feeReceiver) external onlyOwner {
        require(_feeReceiver != address(0), "VaultManager: zero address");
        feeReceiver = _feeReceiver;
        emit FeeReceiverUpdated(_feeReceiver);
    }

    /// @notice Thay đổi địa chỉ core (SavingCore)
    /// @dev Chỉ owner mới gọi được
    /// @param _coreAddress Địa chỉ SavingCore mới
    function setCoreAddress(address _coreAddress) external onlyOwner {
        require(_coreAddress != address(0), "VaultManager: zero address");
        coreAddress = _coreAddress;
        emit CoreAddressUpdated(_coreAddress);
    }

    // ──────────────────────────── Vault Operations ────────────────────────────

    /// @notice Nạp token vào vault — ai cũng có thể gọi
    /// @dev Phải approve token trước khi gọi
    /// @param amount Số lượng token muốn nạp
    function fundVault(uint256 amount) external whenNotPaused {
        require(amount > 0, "VaultManager: zero amount");
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    /// @notice Rút token khỏi vault — chỉ owner
    /// @param amount Số lượng token muốn rút
    function withdrawVault(uint256 amount) external onlyOwner whenNotPaused {
        require(amount > 0, "VaultManager: zero amount");
        require(token.balanceOf(address(this)) >= amount, "VaultManager: insufficient balance");
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Trả lãi cho user — chỉ SavingCore mới gọi được
    /// @dev Gọi khi user rút tiền đúng hạn
    /// @param to Địa chỉ nhận lãi
    /// @param amount Số tiền lãi
    function payInterest(address to, uint256 amount) external onlyCore {
        require(amount > 0, "VaultManager: zero amount");
        require(token.balanceOf(address(this)) >= amount, "VaultManager: insufficient balance");
        token.safeTransfer(to, amount);
        emit InterestPaid(to, amount);
    }

    // ──────────────────────────── View Functions ────────────────────────────

    /// @notice Xem số dư token hiện tại của vault
    /// @return uint256 số dư token
    function vaultBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    // ──────────────────────────── Pause/Unpause ────────────────────────────

    /// @notice Tạm dừng vault —阻止 nạp/rút
    /// @dev Chỉ owner mới gọi được
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Bỏ tạm dừng vault
    /// @dev Chỉ owner mới gọi được
    function unpause() external onlyOwner {
        _unpause();
    }
}
