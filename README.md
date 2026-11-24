# DSH Tavern 纯净写作

`dsh-tavern-pure-writer` 是独立安装的 DSH Tavern 插件。它把查询和工具调用交给白手套 Agent，让前台 Agent 专注生成正文，只保留防截断用的 `submit_story`。

每轮先组装两边共享的人物设定、写作要求、故事原文和本轮玩家输入。白手套在共享内容末尾接到查询任务和 Skill 目录，交稿提示只发给前台。宿主压缩过的历史也会随请求保留，包括压缩记录里保留的正文原文。白手套结束后，酒馆按调用顺序把查询回执中的自然语言文本原样附在前台本轮请求末尾。宿主默认过滤前后台模型请求和「轨迹」中的系统提醒，Skill 相关提示可保留。查询回执可在白手套的轨迹中查看，模型实际读到的正文可在对应 Agent 的「完整上下文」中查看。

## 宿主兼容性

插件需要 `tavern.capabilities.writingPreparation === 5`。[宿主兼容补丁](compat/tavern-host.patch) 以 Tavern 提交 `3dd131c9e` 为基线，添加这个接口及对应的正文请求流程。将补丁应用到准备运行的 Tavern 源码副本，再用该副本安装或同步宿主。

```sh
git -C /path/to/dsh-tavern apply --check /path/to/dsh-tavern-pure-writer/compat/tavern-host.patch
git -C /path/to/dsh-tavern apply /path/to/dsh-tavern-pure-writer/compat/tavern-host.patch
```

## 安装插件

将仓库克隆到所用 Tavern 的持久数据目录 `plugins/dsh-tavern-pure-writer/` 下，或将插件包解压到这个位置。CLI 版默认的目标目录是 `~/.dsh-tavern/profile-data/tavern/data/plugins/dsh-tavern-pure-writer/`。重启宿主，在「设置 → DSH Tavern → 插件」确认插件已加载。停用插件后，下一轮恢复 Tavern 的原有生成流程。

白手套 Agent 使用该局的后台模型，查完直接结束。程序只交接工具回执，并过滤白手套生成的回复文字。有回执时，程序将原文保存在当轮玩家输入与正文之间，后续请求随会话历史读取。查询结果为空时，程序直接开始正文生成。

## 测试

在插件仓库运行下列命令，指向已应用宿主补丁的 Tavern 源码。

```sh
TAVERN_HOST_ROOT=/path/to/dsh-tavern node --test tests/inject.test.mjs
```
