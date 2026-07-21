// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC
/// @notice Token ERC-20 giả lập dùng USDC, 6 decimals, dùng để test
/// @dev Không có hạn chế ai có thể mint — chỉ dùng cho testnet
contract MockUSDC is ERC20 {
    /// @notice Khởi tạo token với tên "Mock USDC" và symbol "USDC"
    constructor() ERC20("Mock USDC", "USDC") {}

    /// @notice Trả về số decimals = 6 (giống USDC thật)
    /// @return uint8 số decimals
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint token cho một địa chỉ bất kỳ
    /// @dev Ai cũng có thể gọi — chỉ dùng cho test
    /// @param to Địa chỉ nhận token
    /// @param amount Số lượng token muốn mint
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
