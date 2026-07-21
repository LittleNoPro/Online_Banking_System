# Kế hoạch 6 ngày — Online Banking System (Blockchain Programming Final Project)

> **Trước khi bắt đầu (làm ngay, 10 phút):**
> Tính giá trị biến thể cá nhân theo MSSV của bạn (A = số cuối, B = số áp chót):
> - Grace period = (A mod 3) + 2 ngày
> - Default APR = 200 + A×25 bps
> - Early withdraw penalty = 300 + B×50 bps
> - Default tenor = B chẵn → 90 ngày, B lẻ → 180 ngày
>
> Ghi 4 số này ra giấy/README ngay từ bây giờ — mọi test và demo phải khớp với số này.

**MSSV: 33 | A=3, B=3**
- Grace period = (3 mod 3) + 2 = 2 ngày
- Default APR = 200 + 3×25 = 275 bps
- Early withdraw penalty = 300 + 3×50 = 450 bps
- Default tenor = 3 lẻ → 180 ngày

---

## Nguyên tắc chung khi làm

- **Code trước, viết README song song**, đừng để dồn README vào cuối — bạn sẽ quên lý do mình chọn thiết kế đó.
- Mỗi khi viết xong 1 hàm → viết test cho hàm đó ngay (test-as-you-go), không dồn hết vào Day 4.
- Dùng Hardhat + OpenZeppelin (ERC721, Ownable, Pausable, ReentrancyGuard) làm nền, nhưng đọc code OZ để hiểu — sẽ cần trả lời câu hỏi vấn đáp về việc này.
- Commit Git sau mỗi buổi làm việc (lịch sử commit rõ ràng cũng là điểm cộng uy tín khi giải trình).

---

## Ngày 1 — Setup + MockUSDC + VaultManager

**Mục tiêu cuối ngày:** Project khởi tạo xong, 2/3 contract (MockUSDC, VaultManager) viết + test xong.

- [x] Khởi tạo project: `npx hardhat init`, cài OpenZeppelin (`@openzeppelin/contracts`), cấu hình `hardhat.config.js` (solidity version, networks local).
- [x] Thiết lập cấu trúc thư mục: `contracts/`, `test/`, `scripts/`, `frontend/`.
- [x] Viết **MockUSDC.sol**:
  - ERC20, tên/symbol tự chọn, `decimals()` override trả về 6.
  - Hàm `mint(address, uint256)` public cho ai cũng gọi được (test token).
- [x] Viết **VaultManager.sol**:
  - State: `feeReceiver`, liên kết với token (MockUSDC).
  - `fundVault(uint256 amount)` — admin (hoặc ai cũng được, tùy bạn) nạp token vào vault.
  - `withdrawVault(uint256 amount)` — chỉ owner, rút token ra.
  - `setFeeReceiver(address)` — chỉ owner.
  - `pause()` / `unpause()` dùng OZ `Pausable`.
  - Hàm nội bộ để SavingCore gọi rút lãi trả cho user (`payInterest` hoặc tương tự) — chỉ cho phép SavingCore gọi (dùng `onlyCore` modifier hoặc `Ownable` set SavingCore address).
- [x] Viết test cơ bản cho cả 2 contract: mint, fund, withdraw, pause/unpause, setFeeReceiver (permission check — non-owner phải revert).
- [x] Ghi lại 4 giá trị biến thể cá nhân vào đầu file README (khung sườn).

**Checkpoint cuối ngày:** `npx hardhat test` chạy pass cho MockUSDC + VaultManager. ✅

---

## Ngày 2 — SavingCore: Plan + Open Deposit + Withdraw at Maturity

**Mục tiêu cuối ngày:** Luồng quan trọng nhất (mở sổ, rút đúng hạn) chạy đúng, có test.

- [x] Viết struct `Plan` (tenorDays, aprBps, minDeposit, maxDeposit, earlyWithdrawPenaltyBps, enabled).
- [x] Viết struct `Deposit`/certificate (owner ngầm định qua NFT, planId, principal, startAt, maturityAt, aprBpsAtOpen, penaltyBpsAtOpen, status enum).
- [x] Kế thừa ERC721 cho SavingCore (mỗi deposit = 1 tokenId).
- [x] Admin functions: `createPlan`, `updatePlan`, `enablePlan`, `disablePlan` — nhớ emit `PlanCreated`, `PlanUpdated`.
- [x] `openDeposit(planId, amount)`:
  - Check plan enabled, amount trong [min, max].
  - `transferFrom` token từ user vào SavingCore (principal giữ ở đây, KHÔNG ở vault).
  - Mint NFT, lưu snapshot APR/penalty tại thời điểm mở.
  - Set `maturityAt = block.timestamp + tenorDays * 86400`.
  - Emit `DepositOpened`.
- [x] `withdrawAtMaturity(depositId)`:
  - Check `msg.sender` là owner của NFT, status Active, `block.timestamp >= maturityAt` (quyết định dùng `>=` hay `>` — ghi chú lại lý do vì đây là câu hỏi mở #5).
  - Tính lãi đơn: `(principal * aprBpsAtOpen * tenorSeconds) / (365*24*3600*10000)` — **nhân trước, chia sau**.
  - Gọi VaultManager trả lãi cho user; trả principal từ SavingCore. Nếu vault không đủ → revert (theo base spec).
  - Update status = Withdrawn, emit `Withdrawn`.
- [x] Test: happy path đúng số Alice ví dụ (1000 USDC, 90 ngày, 250 bps ≈ 6.16 USDC lãi) + test rút quá sớm phải revert + test rút 2 lần phải revert + test dùng đúng giá trị cá nhân (APR/tenor của bạn).

**Checkpoint cuối ngày:** Mở sổ → fast-forward thời gian bằng Hardhat time helpers → rút đúng hạn ra đúng số tiền. ✅

---

## Ngày 3 — Early Withdraw + Manual Renew + Auto Renew + Rule Enforcement

**Mục tiêu cuối ngày:** Toàn bộ 5 luồng nghiệp vụ trong Section 3 hoạt động đầy đủ.

- [ ] `earlyWithdraw(depositId)`:
  - Check `block.timestamp < maturityAt`.
  - `penalty = (principal * penaltyBpsAtOpen) / 10000`; user nhận `principal - penalty`; penalty chuyển cho `feeReceiver`.
  - Lãi = 0. Emit `Withdrawn(..., isEarly=true)`.
- [ ] `renewDeposit(depositId, newPlanId)` (manual):
  - Check `msg.sender` owner, `block.timestamp >= maturityAt`, status Active.
  - Tính lãi của sổ cũ → `newPrincipal = oldPrincipal + interest`.
  - Mint NFT mới theo `newPlanId` (APR mới snapshot từ plan mới).
  - Set status sổ cũ = ManualRenewed. Emit `Renewed`.
- [ ] `autoRenewDeposit(depositId)`:
  - Check `block.timestamp >= maturityAt + gracePeriod` (dùng grace period **cá nhân** của bạn).
  - Giữ nguyên **tenor và APR gốc** (aprBpsAtOpen cũ, không lấy plan hiện tại).
  - `newPrincipal = oldPrincipal + interest`, mint NFT mới, set status cũ = AutoRenewed.
  - Ai cũng gọi được (bot off-chain), không cần là owner.
- [x] Thêm `ReentrancyGuard` (OZ) cho các hàm rút tiền — chuẩn bị cho câu hỏi #7 (attack thinking).
- [x] Đảm bảo `pause()` chặn được withdraw/renew (check `whenNotPaused`).
- [ ] Test cho từng hàm: early withdraw đúng số, renew đúng principal mới, auto-renew fail trước grace period / pass sau grace period / APR bị lock đúng, pause chặn rút.
- [ ] Bắt đầu nháp câu trả lời cho 7 câu hỏi mở trong `README.md` — viết ngay khi vừa code xong phần liên quan (đừng để dồn cuối).

**Checkpoint cuối ngày:** Cả 5 user flow + admin functions + events đầy đủ, tất cả test pass.

---

## Ngày 4 — Hoàn thiện Test Suite (coverage > 90%) + 1 Bonus Challenge (nếu còn thời gian)

**Mục tiêu cuối ngày:** Test coverage > 90%, các edge case trong đề được cover hết.

- [ ] Rà lại danh sách test bắt buộc trong Section 7.2 và tick từng cái:
  - createPlan: valid / disabled / invalid APR.
  - openDeposit: happy path / dưới min / trên max / plan disabled.
  - withdrawAtMaturity: đúng lãi / quá sớm / đã rút rồi.
  - earlyWithdraw: đúng penalty / lãi = 0.
  - renewDeposit: đúng principal mới / update status.
  - autoRenewDeposit: trước grace period (fail) / sau grace period / APR lock.
  - Vault: fund / withdraw / vault không đủ tiền trả lãi (phải revert).
  - Pause: withdraw bị chặn khi pause.
- [ ] Chạy `npx hardhat coverage`, xem dòng nào chưa cover → viết thêm test bổ sung.
- [ ] Test riêng cho các câu hỏi mở (rất quan trọng vì sẽ được hỏi vấn đáp):
  - Test NFT transfer rồi chủ mới rút thử (câu hỏi #1).
  - Test rounding dust — chứng minh ai giữ phần dư (câu hỏi #4) bằng 1 test case cụ thể.
  - Test boundary time: đúng giây maturityAt, đúng giây hết grace period (câu hỏi #5).
  - Test disable plan nhưng vẫn còn deposit active, thử renew vào plan đã tắt (câu hỏi #6).
- [ ] **Chọn 1 bonus challenge dễ làm nhất** (khuyến nghị **C3 - Partial early withdrawal** hoặc **C2 - Solvency guard**, vì độ phức tạp vừa phải) và implement + test nếu còn thời gian trong ngày. Nếu không kịp, dời sang buffer Ngày 6.
- [x] Viết NatSpec comment cho các hàm chính (phục vụ điểm "Code quality").

**Checkpoint cuối ngày:** Coverage report > 90%, không còn TODO trong contract logic.

---

## Ngày 5 — Frontend React (Demo) + Admin flow qua UI

**Mục tiêu cuối ngày:** Frontend chạy được, kết nối MetaMask, thực hiện đủ các thao tác user cần.

- [ ] Setup React app (Vite hoặc CRA), cài `ethers.js`, import ABI từ Hardhat artifacts.
- [ ] Kết nối ví MetaMask (`window.ethereum`, `eth_requestAccounts`).
- [ ] Trang **View Plans**: đọc `getPlan`/`plans` từ contract, hiển thị tenor, APR, min/max.
- [ ] Trang **Open Deposit**: form nhập planId + amount → gọi `approve` trên MockUSDC → gọi `openDeposit`.
- [ ] Trang **My Deposits**: liệt kê NFT của user (dùng `balanceOf` + `tokenOfOwnerByIndex` hoặc lắng nghe event `DepositOpened`/`Transfer`), hiển thị trạng thái, thời gian đáo hạn còn lại.
- [ ] Nút **Withdraw** và **Renew** trên từng deposit, gọi đúng hàm tương ứng, xử lý trạng thái loading/error.
- [ ] (Nếu có thời gian) Trang admin đơn giản: tạo plan, fund vault, pause/unpause — không cần đẹp, chỉ cần chạy được vì phần này chỉ 10 điểm UX.
- [ ] Test thủ công toàn bộ luồng trên local Hardhat node (`npx hardhat node` + deploy script) để đảm bảo demo video không bị lỗi.
- [ ] Viết `scripts/deploy.js` deploy cả 3 contract + set liên kết giữa chúng (SavingCore biết VaultManager, VaultManager biết SavingCore) + tạo sẵn 1-2 plan mẫu bằng giá trị cá nhân của bạn.

**Checkpoint cuối ngày:** Có thể mở sổ, xem sổ, rút/renew hoàn toàn qua giao diện, không cần console.

---

## Ngày 6 — README hoàn chỉnh + Design Answers + Video Demo + Buffer/Rà soát

**Mục tiêu cuối ngày:** Nộp bài hoàn chỉnh, sẵn sàng vấn đáp.

- [ ] Hoàn thiện `README.md` gồm đủ:
  - Hướng dẫn cài đặt, chạy test, deploy local.
  - Giá trị biến thể cá nhân (MSSV, A, B, 4 số tính ra).
  - Mục **"Design Answers"** trả lời đầy đủ 7 câu hỏi Section 8.2, mỗi câu 3-6 câu, **trỏ đúng vào dòng code** tương ứng (copy snippet ngắn hoặc ghi số dòng/file).
  - Ghi chú bonus challenge đã làm: vấn đề - giải pháp - trade-off.
  - Giải thích các quyết định thiết kế khác biệt so với đề (nếu có) — bắt buộc theo yêu cầu "an unexplained one is (wrong)".
- [ ] Tự vấn đáp thử: đọc lại 7 câu hỏi, tự hỏi "nếu đổi số liệu thì sao" (vd: "nếu penalty = 0 bps thì code chạy sao") để chuẩn bị tinh thần cho phần giáo viên hỏi ngẫu nhiên.
- [ ] Quay **video demo 3-5 phút**:
  - Giới thiệu nhanh kiến trúc 3 contract.
  - Demo qua frontend: tạo plan (nếu có UI) → mở sổ → fast-forward/đợi → rút hoặc renew.
  - Số liệu trong video phải khớp với giá trị cá nhân đã khai báo.
- [ ] Chạy lại toàn bộ `npx hardhat test` + `npx hardhat coverage` lần cuối, chụp/lưu kết quả coverage để đính kèm README.
- [ ] Dọn dẹp code: xóa console.log thừa, format lại, kiểm tra `.gitignore` (không commit `node_modules`, `.env`).
- [ ] Push GitHub repo, kiểm tra repo public/đủ quyền cho giáo viên xem, kiểm tra README hiển thị đúng trên GitHub.
- [ ] **Buffer**: nếu Ngày 4-5 bị trễ, đây là ngày dự phòng — ưu tiên xử lý theo thứ tự: (1) test coverage đạt 90%, (2) Design Answers đầy đủ, (3) frontend chạy được cơ bản, (4) bonus challenge là thứ bỏ đầu tiên nếu thiếu thời gian.

**Checkpoint cuối ngày:** Repo hoàn chỉnh, video quay xong, sẵn sàng nộp và vấn đáp.

---

## Bảng tổng quan tiến độ

| Ngày | Trọng tâm | Deliverable chính | Trạng thái |
|---|---|---|---|
| 1 | Setup + MockUSDC + VaultManager | 2/3 contract nền tảng, test cơ bản | ✅ Done |
| 2 | SavingCore: Plan + Open + Withdraw at Maturity | Luồng quan trọng nhất chạy đúng | ✅ Done |
| 3 | Early withdraw + Renew (manual/auto) + rule enforcement | Đủ 5 user flow + events | 🔲 Todo |
| 4 | Test suite đầy đủ, coverage >90% | Test coverage + edge case + (bonus nếu kịp) | 🔲 Todo |
| 5 | Frontend React | Demo UI chạy đầy đủ luồng user | 🔲 Todo |
| 6 | README + Design Answers + Video + Buffer | Sản phẩm hoàn chỉnh sẵn sàng nộp | 🔲 Todo |

**Lưu ý sống còn:** Đừng để Design Answers dồn hết vào Ngày 6 — viết nháp ngay khi vừa code xong phần liên quan (đã nhắc ở Ngày 2-3), vì đây là phần bạn dễ mất điểm nhất khi vấn đáp nếu chỉ nhớ mù mờ.
