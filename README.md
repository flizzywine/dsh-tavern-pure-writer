# DSH Tavern 纯净写作

`dsh-tavern-pure-writer` 是独立安装的 DSH Tavern 插件。它把查询和工具调用交给白手套 Agent，让前台 Agent 专注生成正文，只保留防截断用的 `submit_story`。

白手套 Agent 按需读取 Skill 和 reference，查询世界书、记忆和变量。插件记录实际返回给白手套 Agent 的工具回执。白手套调用 `inject({})` 后，回执文本按调用顺序原样进入前台 Agent 的本轮上下文。

## 宿主兼容性

插件需要 `tavern.capabilities.writingPreparation === 3`。[宿主兼容补丁](compat/tavern-host.patch) 以 Tavern 提交 `3dd131c9e` 为基线，添加这个接口及对应的正文请求流程。将补丁应用到准备运行的 Tavern 源码副本，再用该副本安装或同步宿主。

```sh
git -C /path/to/dsh-tavern apply --check /path/to/dsh-tavern-pure-writer/compat/tavern-host.patch
git -C /path/to/dsh-tavern apply /path/to/dsh-tavern-pure-writer/compat/tavern-host.patch
```

## 安装插件

将仓库克隆到所用 Tavern 的持久数据目录 `plugins/dsh-tavern-pure-writer/` 下，或将插件包解压到这个位置。CLI 版默认的目标目录是 `~/.dsh-tavern/profile-data/tavern/data/plugins/dsh-tavern-pure-writer/`。重启宿主，在「设置 → DSH Tavern → 插件」确认插件已加载。停用插件后，下一轮恢复 Tavern 的原有生成流程。

白手套 Agent 使用该局的后台模型。前台收到与白手套实际看到的回执相同的文本，包括空查询和错误回执。若本轮没有调用查询工具，`inject({})` 直接开始正文生成。

## 测试

在插件仓库运行下列命令，指向已应用宿主补丁的 Tavern 源码。

```sh
TAVERN_HOST_ROOT=/path/to/dsh-tavern node --test tests/inject.test.mjs
```
