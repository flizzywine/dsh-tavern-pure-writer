# DSH Tavern 纯净写作

`dsh-tavern-pure-writer` 是独立安装的 DSH Tavern 插件。启用后，前置 Agent 可按本轮写作需求查询 Skill、世界书、变量和历史记忆，再用 `inject` 发送相关原文片段。前台 Agent 读取这些片段和近期剧情，写作时只开放 `submit_story`。

## 宿主兼容性

插件需要 `tavern.capabilities.writingPreparation === 1`。[宿主兼容补丁](compat/tavern-host.patch) 以 Tavern 提交 `cf8a15129` 为基线，添加这个接口及对应的正文请求流程。将补丁应用到准备运行的 Tavern 源码副本，再用该副本安装或同步宿主。

```sh
git -C /path/to/dsh-tavern apply --check /path/to/dsh-tavern-pure-writer/compat/tavern-host.patch
git -C /path/to/dsh-tavern apply /path/to/dsh-tavern-pure-writer/compat/tavern-host.patch
```

## 安装插件

将仓库克隆到所用 Tavern 的持久数据目录 `plugins/dsh-tavern-pure-writer/` 下，或将插件包解压到这个位置。CLI 版默认的目标目录是 `~/.dsh-tavern/profile-data/tavern/data/plugins/dsh-tavern-pure-writer/`。重启宿主，在「设置 → DSH Tavern → 插件」确认插件已加载。停用插件后，下一轮恢复 Tavern 的原有生成流程。

前置 Agent 使用该局的后台模型，每轮最多注入 8 条、合计 4000 字。玩家明确要求沿用某个写作 Skill 时，前置 Agent 会为本轮重新选取相关指引。
