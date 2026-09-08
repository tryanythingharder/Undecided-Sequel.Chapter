# Windows 代码签名证书采购指南

> 状态：签名链路已全部接好并验证（2026-09，commit 见 git log）。**缺的只是一张受信任的
> 真证书**——本文件整理可选项与成本，供决策用，不替你选。

## 为什么需要

未签名（或自签名）的 Windows 产物：

- 下载运行时 SmartScreen 弹「Windows 已保护你的电脑 / 未知发布者」，普通用户大概率放弃
- 部分杀软（Defender、360、火绒）对未签名 exe 的启发式误报概率显著更高
- 自签名证书无法解决以上任何一条——信任必须来自操作系统内置的受信根（以及微软的
  SmartScreen 信誉库），只有付费证书能做到

## 证书形态对比（2026-09 市场概况）

| 形态 | 价格区间/年 | SmartScreen | 硬件令牌 | 适合 |
|---|---|---|---|---|
| OV 代码签名证书 | ~¥600–1200（Certum 开源版约 €79 是最低价） | 需要信誉积累期（前期仍弹警告，下载量上去后消退） | 2023-06 起CA/B Forum强制要求私钥存硬件令牌（USB）或HSM | 个人/开源项目最现实的选择 |
| EV 代码签名证书 | ~¥2500–3500 | **即时豁免**（新证书首次发布即不弹） | 同上（必须） | 追求开箱即无警告 |
| Azure Key Vault 托管 | 证书本身价格同上 + Azure 使用费 | 同 OV/EV | 私钥不离开云 HSM | 不想管物理 USB 令牌的团队 |

价格来源：SSL.com / Certum / Sectigo / GlobalSign 2026 年公开报价，购买前自行复核。

## 本仓库已支持的三种接法

### A. GitHub Secrets + USB 令牌（最常见，需要把令牌内容导出）

USB 硬件令牌的私钥**按规范不能导出**，所以这条路的实际做法是购买时选择「支持导出 PFX」
的 CA（部分 CA 提供云端签名或签名服务），或者：

1. 联系 CA 确认支持 **PFX 文件交付**或**云签名 API**
2. 若拿到 .pfx：`base64 -w0 证书.pfx` 后填入 GitHub Secret `CSC_LINK`，证书密码填
   `CSC_KEY_PASSWORD`
3. 推 tag 即自动签名——CI 会用 `scripts-dev/check-windows-signing.cjs` 断言签名落上

### B. 云 HSM / 签名服务（无 USB 令牌的合规等价物）

支持 DigiCert KeyLocker、Azure Trusted Signing、SSL.com eSigner 等。electron-builder 26
原生支持 Azure Trusted Signing（`build.win.azureSignOptions`）。若选这条路告诉我，我再加
对应的 build 配置与 CI 作业。

### C. Certum 开源代码签名证书（个人开源项目的最低价路线）

€79/年（Open Source Code Signing certificate），面向开源项目开发者，验证身份证 + 开源
项目 URL 即可。注意：交付也是 USB 令牌形式，需确认其「文件签名」工作流能否导出或走
API——需要购买前向 Certum 确认与 GitHub Actions 的兼容性。

## 买到证书后要做的（仅两步）

```
1. GitHub 仓库 Settings → Secrets and variables → Actions：
   CSC_LINK       = base64 单行编码的 .pfx 内容（PowerShell: [Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx"))）
   CSC_KEY_PASSWORD = 证书导出密码
2. 正常发版：bump 版本 → 提交 → git tag v1.x.y → git push --tags
```

Release 工作流会自动：解码证书到 runner 临时目录（不落仓库）→ electron-builder 签名全部
5 个产物（主 exe / Setup / Portable / NSIS 卸载器 / elevate.exe，SHA-256 + RFC3161 时间戳，
时间戳服务器 digicert）→ 闸门脚本断言三个主产物全部带签名后才放行 Release 发布。

## 已完成的链路验证（自签名证书，2026-09）

- `CSC_LINK` 两种注入形式实测通过：本地文件路径、base64（CI 实际形态，证书解码进
  runner 临时目录、绝不落仓库）
- 5 个产物全部真实签名（Get-AuthenticodeSignature 均能读出证书主体 + RFC3161 时间戳）
- 闸门脚本三分支实测：已配置+签名全在 → PASS；未配置 → 显式 WARN 不阻断；已配置但有
  产物缺签名 → FAIL 退出 1（防 secret 配错时静默发布未签名产物）
- signtool 由 electron-builder 自动下载（win-codesign-windows-x64，带 SHA-256 校验和），
  本机与 CI runner 均无需预装 Windows SDK

## 常见坑

- **RSA key length**:CA 签发普遍要求 ≥2048 位，CSC_LINK 里的 PFX 若是老证书会直接拒签
- **时间戳**:签名时打 RFC3161 时间戳（已默认配 digicert），证书过期后旧签名仍有效；没有
  时间戳的签名证书一过期，所有历史产物全部报「签名无效」
- **SmartScreen 信誉按「证书主体 + 文件」积累**：OV 证书换发新主体（比如公司名变了）会
  重新从零积累信誉
