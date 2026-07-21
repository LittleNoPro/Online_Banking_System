# Kiến Trúc Hệ Thống — Online Banking System

## 1. Tổng Quan

Hệ thống ngân hàng trực tuyến trên blockchain Ethereum, xây dựng bằng Hardhat, OpenZeppelin và Solidity 0.8.28. Người dùng nạp token ERC-20 (MockUSDC) vào các gói tiết kiệm có cố định kỳ hạn, nhận NFT chứng nhận khoản gửi, và hưởng lãi đơn từ kho tiền do protocol quản lý.

---

## 2. Kiến Trúc Hợp Đồng

```
┌─────────────────────────────────────────────────────────────┐
│                    Người dùng (EOA)                         │
│   - Sở hữu token MockUSDC                                   │
│   - Approve SavingCore được phép tiêu token                 │
│   - Gọi openDeposit / withdrawAtMaturity / earlyWithdraw    │
│   - Sở hữu NFT (ERC-721) đại diện chứng nhận tiết kiệm    │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   SavingCore (ERC-721)                      │
│   - Lưu cấu hình Plan (tenor, APR, min/max)                │
│   - Lưu bản ghi Deposit (gốc, trạng thái, timestamps)      │
│   - Mint NFT khi openDeposit (mỗi deposit = 1 tokenId)     │
│   - Giữ token gốc (KHÔNG ở vault)                          │
│   - Tính lãi khi withdrawAtMaturity                         │
│   - Gọi VaultManager.payInterest() trả lãi cho user        │
│   - Gọi VaultManager.payPenalty() nhận phí phạt            │
│   - Quản lý luồng renew (thủ công + tự động)              │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   VaultManager (Pausable)                   │
│   - Giữ token MockUSDC thuộc protocol                      │
│   - fundVault() — ai cũng nạp được token vào vault          │
│   - withdrawVault() — chỉ owner rút được                   │
│   - payInterest(to, amount) — chỉ SavingCore gọi được      │
│   - payPenalty(to, amount) — chỉ SavingCore gọi được       │
│   - pause() / unpause() — chỉ owner                        │
│   - feeReceiver — nhận phí phạt rút sớm                    │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    MockUSDC (ERC-20)                        │
│   - ERC-20 tiêu chuẩn, 6 decimals                          │
│   - Hàm mint() công khai để test                           │
│   - Dùng làm token nạp/rút/lãi/phí phạt                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Khái Niệm Cốt Lõi

### 3.1 Plan (Gói Tiết Kiệm)

**Plan** định nghĩa các điều khoản của sản phẩm tiết kiệm:

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| `tenorDays` | `uint256` | Thời hạn khoản gửi theo ngày (vd: 90, 180) |
| `aprBps` | `uint256` | Lãi suất năm theo basis points (vd: 275 = 2.75%) |
| `minDeposit` | `uint256` | Số tiền gửi tối thiểu |
| `maxDeposit` | `uint256` | Số tiền gửi tối đa |
| `earlyWithdrawPenaltyBps` | `uint256` | Phí phạt rút sớm theo bps (vd: 450 = 4.5%) |
| `enabled` | `bool` | Plan có đang nhận tiền gửi mới không |

Plan được tạo và quản lý bởi admin (owner của SavingCore).

### 3.2 Deposit (Khoản Gửi / Chứng Nhận)

**Deposit** đại diện khoản tiết kiệm của người dùng, được thể hiện dưới dạng NFT:

| Trường | Kiểu | Mô tả |
|--------|------|-------|
| `planId` | `uint256` | Khoản gửi thuộc plan nào |
| `principal` | `uint256` | Số tiền gửi ban đầu |
| `startAt` | `uint256` | Thời điểm mở khoản gửi (block timestamp) |
| `maturityAt` | `uint256` | Thời điểm đáo hạn (= startAt + tenorDays × 86400) |
| `aprBpsAtOpen` | `uint256` | Snapshot APR tại thời điểm mở (khóa suốt đời khoản gửi) |
| `penaltyBpsAtOpen` | `uint256` | Snapshot phí phạt tại thời điểm mở |
| `status` | `enum` | Active, Withdrawn, EarlyWithdrawn, ManualRenewed, AutoRenewed |

Mỗi khoản gửi mint 1 NFT ERC-721 cho người gửi. Chủ NFT có quyền gọi các hàm withdraw/renew.

### 3.3 Tính Lãi

Công thức lãi đơn:

```
lãi = (gốc × aprBps × tenorSeconds) / (365 × 24 × 3600 × 10000)
```

- **Nhân trước, chia sau** để giữ độ chính xác.
- `tenorSeconds = maturityAt - startAt`
- `aprBps` là lãi suất năm; chia cho `365 × 24 × 3600 × 10000` để quy ra mỗi giây.
- Làm tròn: chia nguyên cắt về 0. Dust (phần dư) nằm lại trong vault.

### 3.4 Rút Sớm

Khi người dùng rút trước đáo hạn:

```
phí_phạt = (gốc × penaltyBps) / 10000
người_dùng_nhận = gốc - phí_phạt
```

- Phí phạt chuyển đến `feeReceiver` qua VaultManager.
- Không hưởng lãi.
- Trạng thái deposit chuyển thành `EarlyWithdrawn`.

### 3.5 Gia Hạn

**Gia hạn thủ công** (`renewDeposit`):
- Người gọi phải là chủ NFT.
- Phải ở hoặc sau thời điểm đáo hạn.
- Lãi được tính và cộng vào gốc: `gốc_mới = gốc + lãi`.
- Mint NFT mới với APR và điều khoản **plan mới**.
- Trạng thái deposit cũ chuyển thành `ManualRenewed`.

**Tự động gia hạn** (`autoRenewDeposit`):
- Ai cũng gọi được (bot off-chain).
- Phải ở hoặc sau `maturityAt + gracePeriod`.
- Dùng **APR và tenor gốc** (không lấy giá trị plan hiện tại).
- `gốc_mới = gốc + lãi`.
- Mint NFT mới với điều khoản giống ban đầu.
- Trạng thái deposit cũ chuyển thành `AutoRenewed`.

### 3.6 Grace Period (Hạn Gia Hạn)

Khoảng thời gian sau đáo hạn mà khoản gửi vẫn có thể tự động gia hạn. Nếu người dùng không rút hoặc gia hạn trong grace period, hệ thống sẽ tự động gia hạn.

**Biến thể cá nhân (MSSV=33):** 2 ngày.

---

## 4. Luồng Trạng Thái Deposit

```
                  openDeposit
                      │
                      ▼
               ┌──────────────┐
               │    Active     │◄──── (trạng thái ban đầu)
               └──────┬───────┘
                      │
        ┌─────────────┼─────────────┬─────────────┐
        ▼             ▼             ▼             ▼
  withdrawAtMaturity  earlyWithdraw  renewDeposit  autoRenewDeposit
        │             │             │             │
        ▼             ▼             ▼             ▼
   ┌─────────┐  ┌───────────────┐  ┌──────────────┐  ┌──────────────┐
   │Withdrawn│  │EarlyWithdrawn │  │ManualRenewed │  │AutoRenewed   │
   └─────────┘  └───────────────┘  └──────────────┘  └──────────────┘
```

---

## 5. Bảo Mật

| Rủi ro | Biện pháp |
|--------|-----------|
| Reentrancy | `ReentrancyGuard` trên tất cả hàm external thay đổi state và chuyển token |
| Pausability | `Pausable` trên VaultManager; `whenNotPaused` trên hàm quan trọng |
| Kiểm soát truy cập | `Ownable` cho hàm admin; `onlyCore` cho cầu vault-to-core |
| Cô lập snapshot | APR và phí phạt được snapshot khi tạo deposit — không bị ảnh hưởng bởi thay đổi plan |
| Overflow integer | Solidity 0.8.28 có kiểm soát overflow tích hợp |
| Mất chính xác | Nhân trước chia sau; dust nằm lại vault (trade-off được chấp nhận) |
| Chuyển NFT | Chủ NFT mới kế thừa toàn quyền withdraw/renew — theo thiết kế ERC-721 |

---

## 6. Cấu Trúc File

```
contracts/
├── MockUSDC.sol          # Token ERC-20 test (6 decimals)
├── VaultManager.sol      # Kho tiền protocol, phân phối lãi/phí phạt
└── SavingCore.sol        # Hợp đồng chính: plans, deposits, NFTs, renewals

test/
├── MockUSDC.test.ts      # Tests cho token
├── VaultManager.test.ts  # Tests cho vault
└── SavingCore.test.ts    # Tests cho hợp đồng chính

scripts/
└── deploy.ts             # Script deploy

doc/
├── plan.md               # Kế hoạch 6 ngày
├── Final_Assignment.pdf  # Đề bài gốc
└── architecture.md       # Tài liệu này
```

---

## 7. Từ Viết Tắt & Thuật Ngữ

| Viết tắt | Từ đầy đủ | Mô tả |
|-----------|-----------|-------|
| **APR** | Annual Percentage Rate | Lãi suất năm trước khi cộng dồn |
| **bps** | Basis Points | 1 bps = 0.01%; 275 bps = 2.75% |
| **EOA** | Externally Owned Account | địa chỉ Ethereum do người dùng quản lý (không phải contract) |
| **ERC-20** | Ethereum Request for Comments 20 | tiêu chuẩn token fungible |
| **ERC-721** | Ethereum Request for Comments 721 | tiêu chuẩn token non-fungible (NFT) |
| **MSSV** | Mã Số Sinh Viên | mã số sinh viên |
| **OZ** | OpenZeppelin | thư viện hợp đồng đã audited |
| **Tenor** | Thời hạn | thời gian khoản gửi bị khóa (vd: 90 ngày) |
| **Principal** | Gốc | số tiền gửi ban đầu |
| **Maturity** | Đáo hạn | thời điểm kết thúc khoản gửi và có thể rút |
| **Grace Period** | Hạn gia hạn | thời gian thêm sau đáo hạn trước khi tự động gia hạn |
| **Fee Receiver** | Người nhận phí | địa chỉ nhận phí phạt rút sớm |
| **SafeERC20** | SafeERC20 (OZ) | thư viện chuyển ERC-20 an toàn |
| **Pausable** | Pausable (OZ) | contract có thể pause/unpause bởi owner |
| **Ownable** | Ownable (OZ) | kiểm soát truy cập một chủ |
| **ReentrancyGuard** | ReentrancyGuard (OZ) | chống gọi lại (reentrant) vào hàm được bảo vệ |
| **NatSpec** | Natural Specification | chú thích tài liệu Solidity (///, @notice, @param) |
| **TypeChain** | TypeChain | tạo TypeScript bindings cho hợp đồng |
| **Hardhat** | Hardhat | môi trường phát triển Ethereum |
| **Sepolia** | Sepolia Testnet | mạng test Ethereum |
| **Chain ID** | Chain ID | mã định danh mạng EVM (1=mainnet, 11155111=Sepolia) |
| **RPC** | Remote Procedure Call | endpoint API kết nối node blockchain |
| **ABI** | Application Binary Interface | JSON mô tả hàm/sự kiện hợp đồng cho bên ngoài gọi |
| **EVM** | Ethereum Virtual Machine | môi trường chạy cho smart contract |
| **Gas** | Gas | đơn vị tính toán cho thao tác EVM |
| **Wei** | Wei | đơn vị nhỏ nhất của ETH (10^-18); USDC dùng 6 decimals |
| **Solidity** | Solidity | ngôn ngữ lập trình smart contract cho EVM |
| **Testnet** | Mạng test | blockchain không phải production cho phát triển/test |
| **Mainnet** | Mạng chính | blockchain Ethereum production |
