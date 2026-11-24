# DSH Tavern 纯净写作

`dsh-tavern-pure-writer` 是独立安装的 DSH Tavern 插件。它把查询和工具调用交给白手套 Agent，让前台 Agent 专注生成正文，只保留防截断用的 `submit_story`。

每轮先确定前台要使用的人物设定、写作要求、剧情历史和本轮玩家输入。白手套从同一份上下文出发，在末尾接到查询任务和 Skill 目录，再按需读取资料。查询工具返回自然语言段落，变量状态和变化用普通句子表达。白手套调用 `inject({})` 后，资料按调用顺序原样进入前台本轮上下文的末尾。查询回执状态可在白手套 Agent 的轨迹中查看。

## 宿主兼容性

插件需要 `tavern.capabilities.writingPreparation === 5`。[宿主兼容补丁](compat/tavern-host.patch) 以 Tavern 提交 `3dd131c9e` 为基线，添加这个接口及对应的正文请求流程。将补丁应用到准备运行的 Tavern 源码副本，再用该副本安装或同步宿主。

```sh
git -C /path/to/dsh-tavern apply --check /path/to/dsh-tavern-pure-writer/compat/tavern-host.patch
git -C /path/to/dsh-tavern apply /path/to/dsh-tavern-pure-writer/compat/tavern-host.patch
```

## 安装插件

将仓库克隆到所用 Tavern 的持久数据目录 `plugins/dsh-tavern-pure-writer/` 下，或将插件包解压到这个位置。CLI 版默认的目标目录是 `~/.dsh-tavern/profile-data/tavern/data/plugins/dsh-tavern-pure-writer/`。重启宿主，在「设置 → DSH Tavern → 插件」确认插件已加载。停用插件后，下一轮恢复 Tavern 的原有生成流程。

白手套 Agent 使用该局的后台模型。查询结果为空时，`inject({})` 直接开始正文生成。

## 测试

在插件仓库运行下列命令，指向已应用宿主补丁的 Tavern 源码。

```sh
TAVERN_HOST_ROOT=/path/to/dsh-tavern node --test tests/inject.test.mjs
```
