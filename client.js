window.__ModuleLoader__.load({
  id: 'dsh-tavern-pure-writer',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const name = 'dsh-tavern-pure-writer'
    const modelKey = selection => selection ? JSON.stringify([selection.provider, selection.model]) : ''

    function Settings({ ui, gameId, visible }) {
      const [settings, setSettings] = React.useState(null)
      const [catalog, setCatalog] = React.useState(null)
      const [saving, setSaving] = React.useState(false)
      const [error, setError] = React.useState('')
      const [modelError, setModelError] = React.useState(false)
      const [attempt, reload] = React.useState(0)
      const call = (action, args) => ui.callHost(name + '/' + action, { gameId, ...args })

      React.useEffect(() => {
        if (!visible) return
        let active = true
        setError('')
        setModelError(false)
        call('settings').then(value => { if (active) setSettings(value) }, failure => {
          if (active) setError(failure.message || String(failure))
        })
        call('models').then(value => { if (active) setCatalog(value) }, () => {
          if (active) setModelError(true)
        })
        return () => { active = false }
      }, [ui, gameId, visible, attempt])

      async function save(change) {
        setSaving(true)
        setError('')
        try { setSettings(await call('save-settings', change)) }
        catch (failure) { setError(failure.message || String(failure)) }
        finally { setSaving(false) }
      }

      const selected = modelKey(settings?.selection)
      const missing = selected && !catalog?.some(group => group.provider === settings.selection.provider && group.models.some(model => model.id === settings.selection.model))
      return h('div', { className: 'dsh-tavern-status dsh-local-settings' },
        h('div', { className: 'dsh-tavern-status-body' },
          h('div', { className: 'dsh-local-section' },
            h('label', { className: 'dsh-tavern-background-task' }, '由白手套接管本局写作流程',
              h('input', { type: 'checkbox', role: 'switch', checked: settings?.enabled ?? false, disabled: !settings || saving,
                onChange: event => void save({ enabled: event.target.checked }) })),
            h('label', null, '白手套模型',
              h('select', { value: selected, disabled: !settings || saving,
                onChange: event => {
                  const value = event.target.value
                  const [provider, model] = value ? JSON.parse(value) : []
                  void save({ selection: value ? { provider, model } : null })
                } },
              h('option', { value: '' }, '跟随前台'),
              missing ? h('option', { value: selected }, settings.selection.model + (catalog ? '（已不可用）' : '')) : null,
              catalog?.map(group => h('optgroup', { key: group.provider, label: group.providerName || group.provider },
                group.models.map(model => h('option', { key: model.id, value: modelKey({ provider: group.provider, model: model.id }) }, model.name || model.id)))))),
            !settings && !error ? h('p', { role: 'status' }, '正在读取本局配置…') : null,
            error ? h('p', { role: 'alert', className: 'dsh-local-warning' }, error) : null,
            modelError ? h('p', { role: 'alert', className: 'dsh-local-warning' }, '读取模型列表失败。') : null,
            modelError || (error && !settings) ? h('button', { type: 'button', className: 'dsh-tavern-btn', onClick: () => reload(value => value + 1) }, '重试') : null)))
    }

    return {
      name,
      inject: ['tavernUi'],
      apply({ tavernUi: ui }) {
        ui.registerPanel({
          id: 'white-glove', title: 'DSH Tavern White Glove',
          render: ({ gameId, visible }) => h(Settings, { key: gameId, ui, gameId, visible })
        })
      }
    }
  }
})
