import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { apply } from '../lib/index.js'

const host = process.env.TAVERN_HOST_ROOT
assert.ok(host, '指向已应用 compat/tavern-host.patch 的 Tavern 源码目录：TAVERN_HOST_ROOT')
const domain = module => import(pathToFileURL(resolve(host, 'tavern-plugin/lib/domain', module)))
const { createWritingPreparation } = await domain('writing-preparation.js')
const { createPluginTaskExecution } = await domain('plugin-task-execution.js')
const { projectPureWritingRequest } = await domain('pure-writing-request.js')
const frame = { frameId: 'frame:writing', turn: 3, contributions: [], source: {} }
const input = { gameId: 'game', frame }

function createFixture(readers, runTask) {
  const execution = createPluginTaskExecution({
    runTask,
    requireGame: async sessionId => ({ sessionId }),
    choicesFor: async () => ({ disabled: new Set() }),
    reservedToolNames: new Set(),
    recordError: () => {}
  })
  const preparation = createWritingPreparation({
    allowed: async () => true,
    readSources: () => ({ input: () => ({ input: '去钟楼', recent: [] }), listSkills: () => [{ name: 'short' }], ...readers }),
    runAgent: (owner, task, onToolResult) => execution.runAgent(owner, task, { writingPreparation: true, onToolResult })
  })
  apply({ tavern: { capabilities: { writingPreparation: 3 }, writingPreparation: value => preparation.register('pure-writer', value) } })
  return async () => preparation.prepare(await preparation.forGame(input.gameId), input)
}

test('inject 按调用顺序交付原样回执，保留完整段落与重复结果', async () => {
  const skill = Promise.withResolvers()
  const fragment = '第二段也会交给前台。'.repeat(120)
  const readers = {
    skill: ({ reference }) => reference ? [{ title: reference, text: '参考文件全文。' }] : skill.promise,
    worldbook: () => [{ title: '钟楼', text: '塔钟在整点响。' }],
    memory: ({ turn }) => {
      if (turn) throw new Error('读取失败')
      return [{ title: '第 1 轮', text: '钥匙藏在墙缝。' }]
    },
    variables: () => Array.from({ length: 6 }, (_, i) => ({ title: `变量 ${i}`, text: i + '甲'.repeat(4999) }))
  }
  let outputs
  const prepare = createFixture(readers, async task => {
    assert.match(task.system, /你是白手套 Agent/)
    const tools = Object.fromEntries(task.tools.map(tool => [tool.name, args => task.call(tool.name, args)]))
    const schema = task.tools.find(tool => tool.name === 'inject').parameters
    assert.deepEqual(schema, { type: 'object', properties: {}, required: [], additionalProperties: false })
    assert.match(await tools.inject({ items: [] }), /不接收参数/)
    const base = tools.load_writing_skill({ name: 'short' })
    const reference = await tools.load_writing_skill({ name: 'short', reference: 'references/tower.md' })
    const book = await tools.find_worldbook({ query: '钟楼' })
    const memory = await tools.recall_memory({ query: '钥匙' })
    const duplicate = await tools.recall_memory({ query: '钥匙' })
    const variables = await tools.read_variable_summary({ query: '变量' })
    assert.equal(variables.length, 20000)
    const error = await tools.recall_memory({ turn: 999 })
    assert.deepEqual(JSON.parse(error), { ok: false, error: '读取失败' })
    const done = tools.inject({})
    assert.equal(task.stopToolsWhen(), false)
    assert.match(await tools.find_worldbook({ query: '迟到的查询' }), /已提交/)
    skill.resolve([{ title: 'short', text: '正文第一段。\n\n' + fragment }])
    assert.deepEqual(JSON.parse(await done), { accepted: true })
    assert.equal(task.stopToolsWhen(), true)
    assert.equal(task.acceptWithoutText(), true)
    assert.match(await tools.inject({}), /已提交/)
    outputs = [await base, reference, book, memory, duplicate, variables, error]
  })
  const material = await prepare()
  assert.ok(outputs[0].endsWith(fragment))
  assert.equal(material, outputs.join('\n\n'))

  const user = { id: 'player', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '去钟楼' }] }
  const request = projectPureWritingRequest({
    system: '旧 Skill 目录', messages: [user], toolChoice: 'any',
    tools: [{ name: 'skill' }, { name: 'grep_lorebook' }, { name: 'submit_story' }]
  }, { system: '写正文', material, frame })
  assert.deepEqual(request.tools, [{ name: 'submit_story' }])
  assert.equal(request.toolChoice, undefined)
  assert.equal(request.system, '写正文')
  assert.equal(request.messages[0].content[0].text, `<writing_material>\n${material}\n</writing_material>`)
  assert.equal(request.messages[1], user)
})

test('空查询回执原样传递，无工具调用时直接交接', async () => {
  let titles = [{ title: '上一轮', text: '上一轮资料。' }]
  let queried = true
  const prepare = createFixture({ worldbook: () => titles }, async task => {
    if (queried) await task.call('find_worldbook', { query: '钟楼' })
    await task.call('inject', {})
  })
  assert.match(await prepare(), /上一轮资料/)
  titles = []
  assert.equal(await prepare(), '没有查到资料。')
  queried = false
  assert.equal(await prepare(), '')
})
