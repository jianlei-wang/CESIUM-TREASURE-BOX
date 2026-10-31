;(function () {
  'use strict'

  var TOKEN_KEY = 'cesium-case-admin-token'
  var runtime = window.__CESIUM_STUDIO_CONFIG__ || {}
  var API_BASE = (runtime.apiBaseUrl ? String(runtime.apiBaseUrl).replace(/\/$/, '') : '') + '/api'
  var AUTO_REFRESH_MS = 30000

  var state = {
    token: sessionStorage.getItem(TOKEN_KEY) || '',
    days: 7,
    stats: null,
    catalog: null,
    search: '',
    sort: 'views',
    autoRefreshTimer: null
  }

  var el = {}
  var domIds = [
    'login-view',
    'login-form',
    'token-input',
    'login-error',
    'console-view',
    'updated-at',
    'days-select',
    'auto-refresh',
    'refresh-button',
    'export-button',
    'logout-button',
    'console-error',
    'kpi-total',
    'kpi-total-sub',
    'kpi-today',
    'kpi-week',
    'kpi-tracked',
    'kpi-tracked-sub',
    'trend-range',
    'trend-chart',
    'top-list',
    'category-chart',
    'case-search',
    'case-sort',
    'table-note',
    'case-table-body'
  ]
  domIds.forEach(function (id) {
    el[id] = document.getElementById(id)
  })

  function api(path, options) {
    var opts = options || {}
    var headers = Object.assign({ Accept: 'application/json' }, opts.headers || {})
    if (state.token && opts.auth !== false) headers.Authorization = 'Bearer ' + state.token
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    return fetch(API_BASE + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
    }).then(function (response) {
      if (!response.ok) {
        var error = new Error('HTTP ' + response.status)
        error.status = response.status
        throw error
      }
      return response.json()
    })
  }

  function formatNumber(value) {
    var n = Number(value)
    if (!isFinite(n)) return '0'
    return Math.floor(n).toLocaleString('zh-CN')
  }

  function formatDate(value) {
    if (!value) return '-'
    var date = new Date(value)
    if (isNaN(date.getTime())) return '-'
    var pad = function (n) {
      return String(n).padStart(2, '0')
    }
    return (
      date.getFullYear() +
      '-' +
      pad(date.getMonth() + 1) +
      '-' +
      pad(date.getDate()) +
      ' ' +
      pad(date.getHours()) +
      ':' +
      pad(date.getMinutes())
    )
  }

  function categoryLabel(id) {
    if (!state.catalog) return id
    for (var i = 0; i < state.catalog.categories.length; i += 1) {
      if (state.catalog.categories[i].id === id) return state.catalog.categories[i].label
    }
    return id
  }

  function showLogin(message) {
    el['console-view'].hidden = true
    el['login-view'].hidden = false
    if (message) {
      el['login-error'].textContent = message
      el['login-error'].hidden = false
    } else {
      el['login-error'].hidden = true
    }
    el['token-input'].focus()
  }

  function showConsole() {
    el['login-view'].hidden = true
    el['console-view'].hidden = false
  }

  function setError(message) {
    if (!message) {
      el['console-error'].hidden = true
      el['console-error'].textContent = ''
      return
    }
    el['console-error'].hidden = false
    el['console-error'].textContent = message
  }

  function logout() {
    state.token = ''
    state.stats = null
    sessionStorage.removeItem(TOKEN_KEY)
    stopAutoRefresh()
    showLogin()
  }

  function renderKpis() {
    var stats = state.stats
    el['kpi-total'].textContent = formatNumber(stats.totals.totalViews)
    el['kpi-total-sub'].textContent = '覆盖 ' + formatNumber(stats.totals.trackedCases) + ' 个案例'
    el['kpi-today'].textContent = formatNumber(stats.totals.todayViews)
    el['kpi-week'].textContent = formatNumber(stats.totals.last7DaysViews)
    el['kpi-tracked'].textContent = formatNumber(stats.totals.trackedCases)
    el['kpi-tracked-sub'].textContent = '共 ' + formatNumber(stats.totals.catalogCases) + ' 个案例'
  }

  function renderTrend() {
    var trend = state.stats.trend
    var max = 1
    trend.forEach(function (item) {
      if (item.views > max) max = item.views
    })
    el['trend-range'].textContent = trend.length ? trend[0].date + ' ~ ' + trend[trend.length - 1].date : ''
    el['trend-chart'].classList.toggle('dense', trend.length > 10)
    var html = trend
      .map(function (item) {
        var ratio = Math.max(2, Math.round((item.views / max) * 100))
        var label = item.date.slice(5)
        return (
          '<div class="trend-bar' +
          (item.views ? '' : ' empty') +
          '" title="' +
          item.date +
          '：' +
          formatNumber(item.views) +
          ' 次">' +
          '<b>' +
          formatNumber(item.views) +
          '</b>' +
          '<i style="height:' +
          ratio +
          '%"></i>' +
          '<span>' +
          label +
          '</span>' +
          '</div>'
        )
      })
      .join('')
    el['trend-chart'].innerHTML = html
  }

  function renderTop() {
    var top = state.stats.top
    if (!top.length) {
      el['top-list'].innerHTML = '<li class="panel-note">暂无浏览记录</li>'
      return
    }
    el['top-list'].innerHTML = top
      .map(function (item, index) {
        return (
          '<li class="top-item">' +
          '<em>' +
          (index + 1) +
          '</em>' +
          '<div><h3 title="' +
          escapeHtml(item.title) +
          '">' +
          escapeHtml(item.title) +
          '</h3>' +
          '<p>' +
          escapeHtml(categoryLabel(item.category)) +
          '</p></div>' +
          '<strong>' +
          formatNumber(item.views) +
          '</strong>' +
          '</li>'
        )
      })
      .join('')
  }

  function renderCategories() {
    var list = state.stats.categoryBreakdown
    if (!list.length) {
      el['category-chart'].innerHTML = '<p class="panel-note">暂无浏览记录</p>'
      return
    }
    var max = list[0].views || 1
    el['category-chart'].innerHTML = list
      .map(function (item) {
        var ratio = Math.max(2, Math.round((item.views / max) * 100))
        return (
          '<div class="category-row">' +
          '<span title="' +
          escapeHtml(categoryLabel(item.category)) +
          '">' +
          escapeHtml(categoryLabel(item.category)) +
          '</span>' +
          '<i style="--ratio:' +
          ratio +
          '%"></i>' +
          '<strong>' +
          formatNumber(item.views) +
          '</strong>' +
          '</div>'
        )
      })
      .join('')
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function filteredCases() {
    var keyword = state.search.trim().toLowerCase()
    var rows = state.stats.cases.filter(function (row) {
      if (!keyword) return true
      return (
        row.title.toLowerCase().indexOf(keyword) >= 0 ||
        row.id.toLowerCase().indexOf(keyword) >= 0 ||
        row.category.toLowerCase().indexOf(keyword) >= 0 ||
        categoryLabel(row.category).toLowerCase().indexOf(keyword) >= 0
      )
    })
    rows.sort(function (left, right) {
      if (state.sort === 'title') return left.title.localeCompare(right.title, 'zh-CN')
      if (state.sort === 'lastViewedAt') return String(right.lastViewedAt).localeCompare(String(left.lastViewedAt))
      return right.views - left.views || left.title.localeCompare(right.title, 'zh-CN')
    })
    return rows
  }

  function renderTable() {
    var rows = filteredCases()
    el['table-note'].textContent =
      '共 ' +
      formatNumber(rows.length) +
      ' 条记录，按' +
      (state.sort === 'title' ? '标题' : state.sort === 'lastViewedAt' ? '最近浏览' : '浏览量') +
      '排序'
    if (!rows.length) {
      el['case-table-body'].innerHTML = '<tr><td colspan="5" class="empty-row">没有匹配的案例</td></tr>'
      return
    }
    el['case-table-body'].innerHTML = rows
      .map(function (row) {
        return (
          '<tr>' +
          '<td>' +
          escapeHtml(row.title) +
          '<span class="case-id">' +
          escapeHtml(row.id) +
          '</span></td>' +
          '<td><span class="badge">' +
          escapeHtml(categoryLabel(row.category)) +
          '</span></td>' +
          '<td class="num">' +
          formatNumber(row.views) +
          '</td>' +
          '<td>' +
          formatDate(row.firstViewedAt) +
          '</td>' +
          '<td>' +
          formatDate(row.lastViewedAt) +
          '</td>' +
          '</tr>'
        )
      })
      .join('')
  }

  function render() {
    if (!state.stats) return
    var updated = new Date(state.stats.generatedAt)
    el['updated-at'].textContent = '数据更新于 ' + formatDate(updated.toISOString())
    renderKpis()
    renderTrend()
    renderTop()
    renderCategories()
    renderTable()
  }

  function loadStats() {
    setError('')
    return Promise.all([
      api('/admin/stats?days=' + state.days),
      state.catalog ? Promise.resolve(state.catalog) : api('/admin/catalog')
    ])
      .then(function (results) {
        state.stats = results[0]
        state.catalog = results[1]
        showConsole()
        render()
      })
      .catch(function (error) {
        if (error.status === 401) {
          logout()
          showLogin('登录已失效，请重新输入口令')
          return
        }
        setError('统计数据加载失败：' + error.message)
      })
  }

  function login(token) {
    return fetch(API_BASE + '/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token })
    }).then(function (response) {
      if (response.status === 401) throw Object.assign(new Error('invalid token'), { status: 401 })
      if (response.status === 429) throw Object.assign(new Error('too many attempts'), { status: 429 })
      if (!response.ok) throw new Error('HTTP ' + response.status)
      state.token = token
      sessionStorage.setItem(TOKEN_KEY, token)
      return loadStats()
    })
  }

  function startAutoRefresh() {
    stopAutoRefresh()
    if (!el['auto-refresh'].checked) return
    state.autoRefreshTimer = setInterval(function () {
      if (!el['console-view'].hidden) loadStats()
      else stopAutoRefresh()
    }, AUTO_REFRESH_MS)
  }

  function stopAutoRefresh() {
    if (state.autoRefreshTimer) {
      clearInterval(state.autoRefreshTimer)
      state.autoRefreshTimer = null
    }
  }

  function exportCsv() {
    if (!state.stats) return
    var header = ['案例标识', '案例标题', '分类', '浏览量', '首次浏览', '最近浏览']
    var lines = [header.join(',')]
    filteredCases().forEach(function (row) {
      lines.push(
        [
          csvCell(row.id),
          csvCell(row.title),
          csvCell(categoryLabel(row.category)),
          String(row.views),
          csvCell(row.firstViewedAt),
          csvCell(row.lastViewedAt)
        ].join(',')
      )
    })
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    var url = URL.createObjectURL(blob)
    var link = document.createElement('a')
    link.href = url
    link.download = 'case-views-' + new Date().toISOString().slice(0, 10) + '.csv'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  function csvCell(value) {
    var text = String(value == null ? '' : value)
    if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"'
    return text
  }

  el['login-form'].addEventListener('submit', function (event) {
    event.preventDefault()
    var token = el['token-input'].value.trim()
    if (!token) return
    el['login-error'].hidden = true
    login(token).catch(function (error) {
      if (error.status === 429) showLogin('尝试过于频繁，请稍后再试')
      else showLogin('口令不正确，请重试')
    })
  })

  el['refresh-button'].addEventListener('click', function () {
    loadStats()
  })

  el['export-button'].addEventListener('click', exportCsv)

  el['logout-button'].addEventListener('click', function () {
    logout()
  })

  el['days-select'].addEventListener('change', function (event) {
    state.days = Number(event.target.value) || 7
    loadStats()
  })

  el['auto-refresh'].addEventListener('change', startAutoRefresh)

  el['case-search'].addEventListener('input', function (event) {
    state.search = event.target.value
    renderTable()
  })

  el['case-sort'].addEventListener('change', function (event) {
    state.sort = event.target.value
    renderTable()
  })

  if (state.token) {
    loadStats().catch(function () {
      logout()
      showLogin()
    })
  } else {
    showLogin()
  }
})()
