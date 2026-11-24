# DSH Tavern 纯净写作

`dsh-tavern-pure-writer` 是独立安装的 DSH Tavern 插件。前置 Agent 根据本轮需求读取 Skill 及其参考文件，查询世界书、历史记忆或变量状态，完成后调用 `inject({})`。宿主按调用顺序把各工具返回的资料文本原样合并到本轮正文请求。前台 Agent 直接使用这些资料和近期剧情，写作时只开放防截断用的 `submit_story`。

## 宿主兼容性

插件需要 `tavern.capabilities.writingPreparation === 2`。[宿主兼容补丁](compat/tavern-host.patch) 以 Tavern 提交 `3dd131c9e` 为基线，添加这个接口及对应的正文请求流程。将补丁应用到准备运行的 Tavern 源码副本，再用该副本安装或同步宿主。

```sh
git -C /path/to/dsh-tavern apply --check /path/to/dsh-tavern-pure-writer/compat/tavern-host.patch
git -C /path/to/dsh-tavern apply /path/to/dsh-tavern-pure-writer/compat/tavern-host.patch
```

## 安装插件

将仓库克隆到所用 Tavern 的持久数据目录 `plugins/dsh-tavern-pure-writer/` 下，或将插件包解压到这个位置。CLI 版默认的目标目录是 `~/.dsh-tavern/profile-data/tavern/data/plugins/dsh-tavern-pure-writer/`。重启宿主，在「设置 → DSH Tavern → 插件」确认插件已加载。停用插件后，下一轮恢复 Tavern 的原有生成流程。

前置 Agent 使用该局的后台模型。查询工具按各自的返回范围提供资料，`inject({})` 直接交接本轮收到的资料文本。空查询也可以提交，正文会直接开始生成。

## 测试

在插件仓库运行下列命令，指向已应用宿主补丁的 Tavern 源码。

```sh
TAVERN_HOST_ROOT=/path/to/dsh-tavern node --test tests/inject.test.mjs
```
