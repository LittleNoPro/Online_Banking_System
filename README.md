# Online Banking System

Hệ thống ngân hàng trực tuyến trên blockchain Ethereum.

## Biến thể cá nhân (MSSV: 33)

> A = số cuối = 3, B = số áp chót = 3

| Thông số | Công thức | Giá trị |
|----------|-----------|---------|
| Grace period | (A mod 3) + 2 | 2 ngày |
| Default APR | 200 + A×25 bps | 275 bps (2.75%) |
| Early withdraw penalty | 300 + B×50 bps | 450 bps (4.5%) |
| Default tenor | B lẻ → 180 ngày | 180 ngày |

## Hướng dẫn cài đặt và chạy hệ thống

```bash
git clone <repo-url>
cd Online_Banking_System
npm install

cp .env_example .env   # Chỉnh .env nếu cần
npm run compile         # Compile contracts
npm test                # Chạy tests
```

## Cấu trúc dự án

```
├── contracts/
│   ├── MockUSDC.sol          # Token ERC-20 giả lập (6 decimals)
│   ├── VaultManager.sol      # Quản lý kho tiền protocol
│   └── SavingCore.sol        # Hợp đồng chính: plans, deposits, NFTs, renewals
├── scripts/
│   └── deploy.ts             # Script deploy
├── test/
│   ├── MockUSDC.test.ts      # Tests cho token
│   ├── VaultManager.test.ts  # Tests cho vault
│   └── SavingCore.test.ts    # Tests cho hợp đồng chính
├── doc/
│   ├── plan.md               # Kế hoạch 6 ngày
│   ├── Final_Assignment.pdf  # Đề bài gốc
│   └── architecture.md       # Kiến trúc hệ thống
├── hardhat.config.ts
└── package.json
```

## Lệnh khả dụng

| Lệnh | Mô tả |
|------|-------|
| `npm run compile` | Compile hợp đồng Solidity |
| `npm test` | Chạy tất cả tests |
| `npm run test:gas` | Chạy tests với báo cáo gas |
| `npm run node` | Khởi chạy local Hardhat node |
| `npm run deploy:local` | Deploy lên localhost |
| `npm run deploy:sepolia` | Deploy lên Sepolia testnet |
| `npm run deploy:mainnet` | Deploy lên Ethereum mainnet |

## Contracts

### MockUSDC
- Token ERC-20, 6 decimals
- Hàm `mint()` công khai dùng để test

### VaultManager
- `fundVault(amount)` — ai cũng có thể nạp token vào vault
- `withdrawVault(amount)` — chỉ owner mới rút được
- `payInterest(to, amount)` — chỉ SavingCore mới gọi được
- `pause()` / `unpause()` — chỉ owner

### SavingCore (ERC-721)
- `createPlan(...)` — tạo plan tiết kiệm
- `openDeposit(planId, amount)` — mở sổ, mint NFT
- `withdrawAtMaturity(depositId)` — rút tiền khi đáo hạn
- `earlyWithdraw(depositId)` — rút sớm (bị phạt)
- `renewDeposit(depositId, newPlanId)` — gia hạn thủ công
- `autoRenewDeposit(depositId)` — tự động gia hạn

## Dependencies

- [Hardhat](https://hardhat.org/) — môi trường phát triển
- [Ethers v6](https://docs.ethers.org/v6/) — thư viện tương tác Ethereum
- [OpenZeppelin Contracts](https://www.openzeppelin.com/contracts) — tiêu chuẩn hợp đồng đã audited
- [TypeChain](https://github.com/dethcrypto/TypeChain) — TypeScript bindings cho hợp đồng
