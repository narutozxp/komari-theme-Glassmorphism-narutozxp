# 发布主题与后台在线安装

GitHub Actions 会打包主题并发布到 GitHub Releases。发布成功后，管理员在 Komari 后台粘贴 GitHub 仓库地址即可在线安装。下文的 `OWNER/REPO` 替换为你自己的 GitHub 用户名和仓库名。

## 首次发布

1. 在 GitHub 创建一个公开空仓库，README、许可证和 .gitignore 已随本项目提供。
2. 在本项目目录执行以下命令。若你的仓库已设置为 `origin`，可直接使用它。

   ```bash
   git remote add origin https://github.com/OWNER/REPO.git
   git add -A
   git commit -m "Prepare the customized Komari theme release"
   git push -u origin main
   ```

3. 在 GitHub 的 **Actions** 页确认 **Release On Version Bump** 运行成功。如果 Actions 尚未启用，启用后在该工作流点 **Run workflow**，选择 `main`。第一次发布的版本为 `v3.4.5`，工作流会创建标签并上传安装包。
4. 在 GitHub 的 **Releases** 页确认最新正式版本下有一个 `komari-theme-Glassmorphism-build-*.zip` 附件。这个附件的根目录包含 `komari-theme.json`、`preview.png` 和 `dist/`。GitHub 自动列出的 **Source code (zip)** 只用于查看源码。

发布包内的 `url` 由工作流写入，指向实际运行发布的仓库，供 Komari 后续更新使用。仓库地址导入会读取最新正式 Release 的首个附件，因此这个 Release 只上传一个主题 ZIP。

## 在 Komari 后台在线安装

1. 管理员登录 Komari，打开 **主题管理 → 导入主题**。
2. 输入仓库首页地址 `https://github.com/OWNER/REPO`，点击 **检测**。
3. 检查预览的名称和版本，点击 **确认导入**，然后在主题列表点击 **设为当前主题**。

这个流程已按 Komari 1.6.2 核对。下载由运行 Komari 的服务器发起，服务器需要能访问 GitHub API 和 Release 附件。遇到「获取 GitHub release 信息失败」时，先检查 Releases 页是否有正式发布和附件，再检查 Komari 服务器的网络。

## 发布下一版与在线更新

修改 [主题清单](../komari-theme.json) 顶层的 `version`，例如从 `3.4.5` 改为 `3.4.6`。提交改动并执行 `git push origin main`，等新的 Release 发布成功后，在 Komari 的主题卡片上使用 **更新主题**，或通过同一仓库地址重新导入并确认覆盖。保留主题 ID `Glassmorphism-Starlight`，节点显示和 Ping 绑定会沿用这套主题的设置。

## 可选的主题市场收录

如果希望其他管理员能在 Komari 的 **主题市场** 搜索安装，可以向官方主题市场提交 Pull Request，提供正式 Release 的 ZIP 下载地址和 SHA-256。条目中的 `short`、`version` 与主题包内清单保持一致。

```bash
sha256sum komari-theme-Glassmorphism-build-*.zip
```

请用从对应 Release 下载的附件计算校验值。收录格式见 [Komari 主题开发指南](https://komari-document.pages.dev/dev/theme#主题市场与发布) 和 [官方主题市场](https://github.com/komari-monitor/theme-market)。
