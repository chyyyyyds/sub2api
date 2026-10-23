import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'

import type { ApiKey } from '@/types'
import { keysAPI, usageAPI } from '@/api'
import KeysView from '../KeysView.vue'
import { collectKeys } from '../keysConsole'
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }))
// 集合完整性由 keysConsole.spec 单独验证，此处隔离页面列表与全局统计读取。
vi.mock('../keysConsole', async () => ({ ...await vi.importActual('../keysConsole'), collectKeys: vi.fn().mockResolvedValue([]) }))

const {
  listKeys,
  updateKey,
  getPublicSettings,
  getDashboardApiKeysUsage,
  getAvailableGroups,
  getUserGroupRates,
  showError,
  showSuccess,
  copyToClipboard,
  isCurrentStep,
  nextStep,
} = vi.hoisted(() => ({
  listKeys: vi.fn(),
  updateKey: vi.fn(),
  getPublicSettings: vi.fn(),
  getDashboardApiKeysUsage: vi.fn(),
  getAvailableGroups: vi.fn(),
  getUserGroupRates: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn(),
  copyToClipboard: vi.fn(),
  isCurrentStep: vi.fn(),
  nextStep: vi.fn(),
}))

const messages: Record<string, string> = {
  'common.actions': 'Actions',
  'common.name': 'Name',
  'common.refresh': 'Refresh',
  'common.status': 'Status',
  'keys.apiKey': 'API Key',
  'keys.allGroups': 'All Groups',
  'keys.allStatus': 'All Status',
  'keys.columnSettings': 'Column Settings',
  'keys.createKey': 'Create API Key',
  'keys.created': 'Created',
  'keys.expiresAt': 'Expires',
  'keys.group': 'Group',
  'keys.id': 'ID',
  'keys.currentConcurrency': 'Current Concurrency',
  'keys.lastUsedAt': 'Last Used',
  'keys.lastUsedIP': 'Last Used IP',
  'keys.rateLimitColumn': 'Rate Limit',
  'keys.searchPlaceholder': 'Search name or key...',
  'keys.status.active': 'Active',
  'keys.status.expired': 'Expired',
  'keys.status.inactive': 'Inactive',
  'keys.status.quota_exhausted': 'Quota exhausted',
  'keys.usage': 'Usage',
}

vi.mock('@/api', () => ({
  keysAPI: {
    list: listKeys,
    create: vi.fn(),
    update: updateKey,
    delete: vi.fn(),
    toggleStatus: vi.fn(),
  },
  authAPI: {
    getPublicSettings,
  },
  usageAPI: {
    getDashboardApiKeysUsage,
    getMyApiKeyDailyUsage: vi.fn().mockResolvedValue({ items: [] }),
  },
  userGroupsAPI: {
    getAvailable: getAvailableGroups,
    getUserGroupRates,
  },
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({
    showError,
    showSuccess,
  }),
}))

vi.mock('@/stores/onboarding', () => ({
  useOnboardingStore: () => ({
    isCurrentStep,
    nextStep,
  }),
}))

vi.mock('@/composables/useClipboard', () => ({
  useClipboard: () => ({
    copyToClipboard,
  }),
}))

vi.mock('vue-i18n', async () => {
  const actual = await vi.importActual<typeof import('vue-i18n')>('vue-i18n')
  return {
    ...actual,
    useI18n: () => ({
      t: (key: string) => messages[key] ?? key,
    }),
  }
})

const createApiKey = (): ApiKey => ({
  id: 1,
  user_id: 1,
  key: 'sk-test-key',
  name: 'test-key',
  group_id: null,
  status: 'active',
  ip_whitelist: [],
  ip_blacklist: [],
  last_used_at: null,
  last_used_ip: null,
  quota: 0,
  quota_used: 0,
  expires_at: null,
  created_at: '2026-06-27T00:00:00Z',
  updated_at: '2026-06-27T00:00:00Z',
  current_concurrency: 3,
  rate_limit_5h: 0,
  rate_limit_1d: 0,
  rate_limit_7d: 0,
  usage_5h: 0,
  usage_1d: 0,
  usage_7d: 0,
  window_5h_start: null,
  window_1d_start: null,
  window_7d_start: null,
  reset_5h_at: null,
  reset_1d_at: null,
  reset_7d_at: null,
})

const AppLayoutStub = {
  template: '<div><slot /></div>',
}

const TablePageLayoutStub = {
  template: `
    <div>
      <slot name="filters" />
      <slot name="actions" />
      <slot name="table" />
      <slot name="pagination" />
    </div>
  `,
}

const DataTableStub = {
  name: 'DataTable',
  props: { columns: Array, data: Array, selectedKeys: Array, selectable: Boolean },
  emits: ['sort', 'update:selectedKeys', 'rowClick'],
  template: `
    <div>
      <div data-test="columns">{{ columns.map((col) => col.key).join(',') }}</div>
      <div data-test="columns-meta">{{ JSON.stringify(columns.map((col) => ({ key: col.key, sortable: !!col.sortable }))) }}</div>
      <button data-test="sort-current-concurrency" @click="$emit('sort', 'current_concurrency', 'asc')">
        Sort Current Concurrency
      </button>
      <div v-for="row in data" :key="row.id">
        <div
          v-if="columns.some((col) => col.key === 'id')"
          data-test="key-id"
        >
          <slot name="cell-id" :value="row.id" :row="row" />
        </div>
        <slot name="cell-name" :value="row.name" :row="row" />
        <slot name="cell-status" :row="row" /><slot name="cell-actions" :row="row" />
        <div data-test="current-concurrency">
          <slot name="cell-current_concurrency" :value="row.current_concurrency" :row="row" />
        </div>
        <div
          v-if="columns.some((col) => col.key === 'last_used_ip')"
          data-test="last-used-ip"
        >
          <slot name="cell-last_used_ip" :value="row.last_used_ip" :row="row" />
        </div>
      </div>
      <slot name="empty" />
    </div>
  `,
}

const SelectStub = {
  name: 'Select',
  props: ['modelValue', 'options'],
  emits: ['update:modelValue', 'change'],
  template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"></select>',
}

const SearchInputStub = {
  name: 'SearchInput',
  props: ['modelValue'],
  emits: ['update:modelValue', 'search'],
  template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
}

const PaginationStub = {
  name: 'Pagination',
  props: ['page', 'total', 'pageSize'],
  emits: ['update:page', 'update:pageSize'],
  template: `
    <div>
      <button data-test="page-size-50" @click="$emit('update:pageSize', 50)">50</button>
      <button data-test="page-2" @click="$emit('update:page', 2)">Page 2</button>
    </div>
  `,
}

const IconStub = {
  props: ['name'],
  template: '<span data-test="icon">{{ name }}</span>',
}

const mountView = async () => {
  const wrapper = mount(KeysView, {
    global: {
      stubs: {
        AppLayout: AppLayoutStub,
        TablePageLayout: TablePageLayoutStub,
        DataTable: DataTableStub,
        Pagination: PaginationStub,
        BaseDialog: {
          props: ['show', 'title'],
          emits: ['close'],
          template: '<div v-if="show" role="dialog"><button data-test="close-dialog" @click="$emit(\'close\')">Close</button><slot /><slot name="footer" /></div>',
        },
        ConfirmDialog: true,
        EmptyState: true,
        Select: SelectStub,
        SearchInput: SearchInputStub,
        Icon: IconStub,
        UseKeyModal: true,
        BulkEditKeysModal: true,
        EndpointPopover: true,
        GroupBadge: true,
        GroupOptionItem: true,
        Teleport: true,
      },
    },
  })
  await flushPromises()
  await nextTick()
  return wrapper
}

const visibleColumnKeys = (wrapper: VueWrapper) =>
  wrapper.get('[data-test="columns"]').text().split(',').filter(Boolean)

const visibleColumnMeta = (wrapper: VueWrapper): Array<{ key: string; sortable: boolean }> =>
  JSON.parse(wrapper.get('[data-test="columns-meta"]').text())

const getButtonByText = (wrapper: VueWrapper, text: string) => {
  const button = wrapper.findAll('button').find((item) => item.text().includes(text))
  if (!button) {
    throw new Error(`Button not found: ${text}`)
  }
  return button
}

describe('user KeysView column settings', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(collectKeys).mockResolvedValue([])

    listKeys.mockReset()
    updateKey.mockReset()
    vi.mocked(keysAPI.create).mockReset()
    getPublicSettings.mockReset()
    getDashboardApiKeysUsage.mockReset()
    getAvailableGroups.mockReset()
    getUserGroupRates.mockReset()
    showError.mockReset()
    showSuccess.mockReset()
    copyToClipboard.mockReset()
    isCurrentStep.mockReset()
    nextStep.mockReset()

    listKeys.mockResolvedValue({
      items: [createApiKey()],
      total: 1,
      page: 1,
      page_size: 20,
      pages: 1,
    })
    getPublicSettings.mockResolvedValue({})
    getDashboardApiKeysUsage.mockImplementation(async (ids: number[]) => ({ stats: Object.fromEntries(ids.map(id => [id, { api_key_id:id, today_actual_cost:id/100, total_actual_cost:id/10 }])) }))
    vi.mocked(usageAPI.getMyApiKeyDailyUsage).mockResolvedValue({ items: [], days: 7, start_date: '', end_date: '' })
    getAvailableGroups.mockResolvedValue([])
    getUserGroupRates.mockResolvedValue({})
    isCurrentStep.mockReturnValue(false)
  })

  it.each([
    { initialStatus: 'quota_exhausted', status: 'active', formStatus: 'active' },
    { initialStatus: 'inactive', status: 'inactive', formStatus: 'inactive' },
    { initialStatus: 'active', status: 'active', formStatus: 'inactive' },
  ] as const)('syncs quota reset from $initialStatus to $status with form status $formStatus', async ({ initialStatus, status, formStatus }) => {
    const key: ApiKey = {
      ...createApiKey(), group_id: 1, quota: 10, quota_used: 10,
      status: initialStatus,
    }
    listKeys.mockResolvedValueOnce({ items: [key], total: 1, page: 1, page_size: 20, pages: 1 })
    updateKey.mockResolvedValue({ ...key, status, quota_used: 0 })
    const wrapper = await mountView()
    await getButtonByText(wrapper, 'common.edit').trigger('click')
    await wrapper.get('[data-tour="key-form-name"]').setValue('Unsaved name')
    const statusSelect = wrapper.findAllComponents({ name: 'Select' })
      .find((select) => select.props('options').length === 2 &&
        select.props('options')[0].value === 'active')!
    statusSelect.vm.$emit('update:modelValue', 'inactive')
    await wrapper.get('button[title="keys.resetQuotaUsed"]').trigger('click')
    const confirmation = wrapper.findAllComponents({ name: 'ConfirmDialog' })
      .find((dialog) => dialog.props('title') === 'keys.resetQuotaTitle')!
    confirmation.vm.$emit('confirm')
    await flushPromises()

    expect(updateKey).toHaveBeenNthCalledWith(1, key.id, { reset_quota: true })
    expect(wrapper.findComponent({ name: 'DataTable' }).props('data')[0])
      .toMatchObject({ status, quota_used: 0 })
    expect(statusSelect.props('modelValue')).toBe(formStatus)
    expect((wrapper.get('[data-tour="key-form-name"]').element as HTMLInputElement).value)
      .toBe('Unsaved name')

    await wrapper.get('#key-form').trigger('submit')
    await flushPromises()
    expect(updateKey).toHaveBeenNthCalledWith(2, key.id, expect.objectContaining({ name: 'Unsaved name', status: formStatus }))
    wrapper.unmount()
  })

  it('uses the default API key columns with low-frequency columns hidden', async () => {
    const wrapper = await mountView()

    expect(visibleColumnKeys(wrapper)).toEqual([
      'name',
      'key',
      'vendor',
      'group',
      'current_concurrency',
      'today',
      'month',
      'status',
      'actions',
    ])
    expect(visibleColumnKeys(wrapper)).not.toContain('rate_limit')
    expect(visibleColumnKeys(wrapper)).not.toContain('last_used_at')
    expect(visibleColumnKeys(wrapper)).not.toContain('last_used_ip')
    expect(visibleColumnKeys(wrapper)).not.toContain('id')
  })

  it('opens bulk editing with only selected visible keys', async () => {
    const wrapper = await mountView()
    const table = wrapper.findComponent({ name: 'DataTable' })
    expect(table.props('selectable')).toBe(true)
    table.vm.$emit('update:selectedKeys', [1, 99])
    await nextTick()
    await wrapper.get('[data-test="bulk-edit-keys"]').trigger('click')
    const modal = wrapper.findComponent({ name: 'BulkEditKeysModal' })
    expect(modal.props('show')).toBe(true)
    expect(modal.props('selectedKeys').map((key: ApiKey) => key.id)).toEqual([1])
    wrapper.unmount()
  })

  it.each(['filter', 'page size', 'sort'])('clears selection on %s changes', async (change) => {
    const wrapper = await mountView()
    const table = wrapper.findComponent({ name: 'DataTable' })
    table.vm.$emit('update:selectedKeys', [1])
    await nextTick()
    if (change === 'filter') {
      wrapper.findComponent({ name: 'SearchInput' }).vm.$emit('search')
    } else if (change === 'page size') {
      await wrapper.get('[data-test="page-size-50"]').trigger('click')
    } else {
      table.vm.$emit('sort', 'created_at', 'asc')
    }
    await flushPromises()
    expect(wrapper.findComponent({ name: 'DataTable' }).props('selectedKeys')).toEqual([])
    expect(wrapper.find('[data-test="bulk-edit-keys"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('removes successful keys from the selection and refreshes the table', async () => {
    listKeys.mockResolvedValue({
      items: [createApiKey(), { ...createApiKey(), id: 2, name: 'Second' }],
      total: 2, pages: 1
    })
    const wrapper = await mountView()
    const table = wrapper.findComponent({ name: 'DataTable' })
    table.vm.$emit('update:selectedKeys', [1, 2])
    await nextTick()
    await wrapper.get('[data-test="bulk-edit-keys"]').trigger('click')
    wrapper.findComponent({ name: 'BulkEditKeysModal' }).vm.$emit('updated', [1])
    await flushPromises()
    expect(listKeys).toHaveBeenCalledTimes(2)
    expect(table.props('selectedKeys')).toEqual([2])
    wrapper.unmount()
  })

  it('drops keys that are no longer visible after a refresh', async () => {
    const wrapper = await mountView()
    const table = wrapper.findComponent({ name: 'DataTable' })
    table.vm.$emit('update:selectedKeys', [1])
    await nextTick()
    listKeys.mockResolvedValue({ items: [], total: 0, pages: 0 })
    await wrapper.get('button[title="Refresh"]').trigger('click')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'DataTable' }).props('selectedKeys')).toEqual([])
    wrapper.unmount()
  })

  it('shows a hidden column when toggled and persists the preference', async () => {
    const wrapper = await mountView()

    await wrapper.get('button[title="Column Settings"]').trigger('click')
    await getButtonByText(wrapper, 'Rate Limit').trigger('click')
    await nextTick()

    expect(visibleColumnKeys(wrapper)).toContain('rate_limit')
    expect(localStorage.getItem('api-key-hidden-columns')).toBe(
      JSON.stringify(['id', 'usage', 'expires_at', 'last_used_at', 'last_used_ip'])
    )
    expect(localStorage.getItem('api-key-column-settings-version')).toBe('4')
  })

  it('shows the API key ID column when toggled', async () => {
    const wrapper = await mountView()

    await wrapper.get('button[title="Column Settings"]').trigger('click')
    await getButtonByText(wrapper, 'ID').trigger('click')
    await nextTick()

    expect(visibleColumnKeys(wrapper)).toContain('id')
    expect(wrapper.get('[data-test="key-id"]').text()).toBe('#1')
    expect(visibleColumnMeta(wrapper).find((column) => column.key === 'id')?.sortable).toBe(true)
  })

  it('shows the last used IP column when toggled', async () => {
    listKeys.mockResolvedValueOnce({
      items: [{ ...createApiKey(), last_used_ip: '203.0.113.10' }],
      total: 1,
      page: 1,
      page_size: 20,
      pages: 1,
    })
    const wrapper = await mountView()

    await wrapper.get('button[title="Column Settings"]').trigger('click')
    await getButtonByText(wrapper, 'Last Used IP').trigger('click')
    await nextTick()

    expect(visibleColumnKeys(wrapper)).toContain('last_used_ip')
    expect(wrapper.get('[data-test="last-used-ip"]').text()).toBe('203.0.113.10')
  })

  it('restores column preferences from localStorage on mount', async () => {
    localStorage.setItem('api-key-hidden-columns', JSON.stringify(['group', 'created_at']))
    localStorage.setItem('api-key-column-settings-version', '1')

    const wrapper = await mountView()

    expect(visibleColumnKeys(wrapper)).toEqual([
      'name',
      'key',
      'vendor',
      'current_concurrency',
      'today',
      'month',
      'rate_limit',
      'status',
      'last_used_at',
      'actions',
    ])
    expect(localStorage.getItem('api-key-hidden-columns')).toBe(
      JSON.stringify(['group', 'created_at', 'last_used_ip', 'id', 'usage', 'expires_at'])
    )
    expect(localStorage.getItem('api-key-column-settings-version')).toBe('4')
  })

  it('does not include always-visible columns in the toggleable menu', async () => {
    const wrapper = await mountView()

    await wrapper.get('button[title="Column Settings"]').trigger('click')
    await nextTick()

    const columnMenuText = wrapper.get('.uk-column-menu').text()
    expect(columnMenuText).toContain('API Key')
    expect(columnMenuText).toContain('ID')
    expect(columnMenuText).toContain('Current Concurrency')
    expect(columnMenuText).toContain('Rate Limit')
    expect(columnMenuText).toContain('Last Used IP')
    expect(columnMenuText).not.toContain('Name')
    expect(columnMenuText).not.toContain('Actions')
  })

  it('renders the current concurrency value', async () => {
    const wrapper = await mountView()

    expect(wrapper.get('[data-test="current-concurrency"]').text()).toBe('3')
  })

  it('marks current concurrency as sortable', async () => {
    const wrapper = await mountView()

    const currentConcurrencyColumn = visibleColumnMeta(wrapper).find(
      (column) => column.key === 'current_concurrency'
    )
    expect(currentConcurrencyColumn?.sortable).toBe(true)
  })

  it.each([
    { key: 'current_concurrency', order: 'asc' },
    { key: 'group', order: 'asc' },
    { key: 'group', order: 'desc' },
  ] as const)('keeps filters and resets pagination and selection when sorting $key $order', async ({ key, order }) => {
    getAvailableGroups.mockResolvedValue([{ id: 42, name: 'OpenAI' }])
    const wrapper = await mountView()

    await wrapper.get('[data-test="page-size-50"]').trigger('click')
    await flushPromises()

    await wrapper.findComponent({ name: 'SearchInput' }).vm.$emit('update:modelValue', 'target')
    await wrapper.findComponent({ name: 'SearchInput' }).vm.$emit('search')
    await flushPromises()

    const selects = wrapper.findAllComponents({ name: 'Select' })
    await selects[1].vm.$emit('update:modelValue', 42)
    await flushPromises()
    await selects[2].vm.$emit('update:modelValue', 'active')
    await flushPromises()

    await wrapper.get('[data-test="page-2"]').trigger('click')
    await flushPromises()
    const table = wrapper.findComponent({ name: 'DataTable' })
    table.vm.$emit('update:selectedKeys', [1])
    await nextTick()
    expect(table.props('selectedKeys')).toEqual([1])
    expect(visibleColumnMeta(wrapper).find((column) => column.key === key)?.sortable).toBe(true)
    listKeys.mockClear()

    table.vm.$emit('sort', key, order)
    await flushPromises()

    expect(wrapper.findComponent({ name: 'DataTable' }).props('selectedKeys')).toEqual([])
    expect(listKeys).toHaveBeenLastCalledWith(
      1,
      50,
      {
        search: 'target',
        status: 'active',
        group_id: 42,
        sort_by: key,
        sort_order: order,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  describe('create provider selection', () => {
    const platforms = ['anthropic', 'openai', 'kimi', 'zhipu', 'deepseek', 'minimax', 'gemini', 'grok', 'antigravity', 'composite', 'opencode_go', 'typesafe']
    const availableGroups = platforms.map((platform, index) => ({
      id: index + 1,
      // Deliberately ambiguous names: classification must follow the platform.
      name: `Shared group ${index + 1}`,
      platform,
      rate_multiplier: 1,
      subscription_type: 'standard',
    }))
    const groupSelect = (wrapper: VueWrapper) => wrapper.findComponent('[data-tour="key-form-group"]')
    const optionIds = (wrapper: VueWrapper) => groupSelect(wrapper).props('options').map((option: { value: number }) => option.value)
    const chooseProvider = (wrapper: VueWrapper, value: string) => wrapper.get(`input[name="key-provider"][value="${value}"]`).setValue()
    const openCreate = async () => {
      const wrapper = await mountView()
      await wrapper.get('[data-tour="keys-create-btn"]').trigger('click')
      return wrapper
    }

    beforeEach(() => {
      getAvailableGroups.mockResolvedValue(availableGroups)
    })

    it('classifies all configured platforms and retains the complete table filter', async () => {
      const wrapper = await openCreate()
      expect(wrapper.findAll('input[name="key-provider"]')).toHaveLength(4)
      expect(optionIds(wrapper)).toEqual([1])
      await chooseProvider(wrapper, 'openai')
      expect(optionIds(wrapper)).toEqual([2])
      await chooseProvider(wrapper, 'domestic')
      expect(optionIds(wrapper)).toEqual([3, 4, 5, 6])
      await chooseProvider(wrapper, 'other')
      expect(optionIds(wrapper)).toEqual([7, 8, 9, 10, 11, 12])
      expect(wrapper.findAllComponents({ name: 'Select' })[1].props('options')).toHaveLength(14)
    })

    it('clears the previous group on provider change and submits only the newly selected group', async () => {
      const wrapper = await openCreate()
      await wrapper.get('[data-tour="key-form-name"]').setValue('My key')
      await groupSelect(wrapper).vm.$emit('update:modelValue', 1)
      await chooseProvider(wrapper, 'domestic')
      expect(groupSelect(wrapper).props('modelValue')).toBeNull()
      await wrapper.get('#key-form').trigger('submit')
      expect(keysAPI.create).not.toHaveBeenCalled()
      expect(showError).toHaveBeenCalledWith('keys.groupRequired')

      await groupSelect(wrapper).vm.$emit('update:modelValue', 5)
      vi.mocked(keysAPI.create).mockResolvedValue({ ...createApiKey(), group_id: 5 })
      await wrapper.get('#key-form').trigger('submit')
      await flushPromises()
      expect(keysAPI.create).toHaveBeenCalledOnce()
      expect(vi.mocked(keysAPI.create).mock.calls[0].slice(0, 2)).toEqual(['My key', 5])
    })

    it('defaults to a provider with available groups and disables empty categories', async () => {
      getAvailableGroups.mockResolvedValue([availableGroups[5]])
      const wrapper = await openCreate()
      expect(wrapper.get<HTMLInputElement>('input[value="domestic"]').element.checked).toBe(true)
      expect(wrapper.get<HTMLInputElement>('input[value="anthropic"]').element.disabled).toBe(true)
      expect(optionIds(wrapper)).toEqual([6])
    })

    it('shows the empty state when no groups are available', async () => {
      getAvailableGroups.mockResolvedValue([])
      const wrapper = await openCreate()
      expect(wrapper.get('[data-tour="key-form-provider"]').text()).toContain('common.noGroupsAvailable')
      expect(optionIds(wrapper)).toEqual([])
      expect(wrapper.findAll<HTMLInputElement>('input[name="key-provider"]').every((input) => input.element.disabled)).toBe(true)
    })

    it('selects an available provider when groups arrive after opening', async () => {
      let resolveGroups!: (value: typeof availableGroups) => void
      getAvailableGroups.mockReturnValue(new Promise((resolve) => { resolveGroups = resolve }))
      const wrapper = await openCreate()
      resolveGroups([availableGroups[1]])
      await flushPromises()
      expect(wrapper.get<HTMLInputElement>('input[value="openai"]').element.checked).toBe(true)
      expect(optionIds(wrapper)).toEqual([2])
    })

    it('resets provider and group when reopening create, and preserves edit options', async () => {
      const wrapper = await openCreate()
      await chooseProvider(wrapper, 'domestic')
      await groupSelect(wrapper).vm.$emit('update:modelValue', 5)
      await wrapper.get('[data-test="close-dialog"]').trigger('click')
      await wrapper.get('[data-tour="keys-create-btn"]').trigger('click')
      expect(optionIds(wrapper)).toEqual([1])
      expect(groupSelect(wrapper).props('modelValue')).toBeNull()
      await wrapper.get('[data-test="close-dialog"]').trigger('click')
      await getButtonByText(wrapper, 'common.edit').trigger('click')
      expect(wrapper.find('[data-tour="key-form-provider"]').exists()).toBe(false)
      expect(optionIds(wrapper)).toHaveLength(12)
    })
  })
  it('默认每页 10 条、无厂商与单组均调用真实服务端分页参数', async () => {
    const wrapper = await mountView()
    expect(listKeys).toHaveBeenCalledWith(1,10,expect.objectContaining({group_id:undefined}),expect.anything())
    const group = wrapper.findAllComponents({name:'Select'})[1]
    group.vm.$emit('update:modelValue', 42)
    await flushPromises()
    expect(listKeys).toHaveBeenLastCalledWith(1,10,expect.objectContaining({group_id:42}),expect.anything())
    wrapper.unmount()
  })

  it('厂商完整集合含历史组，过滤后重算分页，换组不扩大创建授权', async () => {
    const all = Array.from({length:25},(_,i)=>({...createApiKey(),id:i+1,name:`Key ${i}`,group_id:i%2?99:1,group:{id:i%2?99:1,name:i%2?'Historical':'Current',platform:'openai',rate_multiplier:i%2?2:1}})) as ApiKey[]
    vi.mocked(collectKeys).mockResolvedValue(all)
    getAvailableGroups.mockResolvedValue([{id:1,name:'Current',platform:'openai',rate_multiplier:1}])
    const wrapper = await mountView()
    const vendor = wrapper.findAllComponents({name:'Select'})[0]
    vendor.vm.$emit('update:modelValue','openai'); vendor.vm.$emit('change','openai')
    await flushPromises()
    const table=wrapper.findComponent({name:'DataTable'})
    expect(table.props('data')).toHaveLength(10)
    expect(wrapper.findComponent({name:'Pagination'}).props('total')).toBe(25)
    wrapper.findComponent({name:'Pagination'}).vm.$emit('update:page',2)
    await flushPromises()
    expect(table.props('data').map((k:ApiKey)=>k.id)).toEqual([15,14,13,12,11,10,9,8,7,6])
    const group = wrapper.findAllComponents({name:'Select'})[1]
    expect(group.props('options').map((g:{value:number})=>g.value)).toContain(99)
    group.vm.$emit('update:modelValue',99)
    await flushPromises()
    expect(wrapper.findComponent({name:'Pagination'}).props('total')).toBe(12)
    expect(table.props('data').every((k:ApiKey)=>k.group_id===99)).toBe(true)
    await getButtonByText(wrapper,'Create API Key').trigger('click')
    const formGroup = wrapper.findAllComponents({name:'Select'}).find(c=>c.attributes('id')==='key-form-group')!
    expect(formGroup.props('options').map((g:{value:number})=>g.value)).not.toContain(99)
    wrapper.unmount()
  })

  it('全局统计超过 100 条时分批，不能只统计当前 10 行', async () => {
    vi.mocked(collectKeys).mockResolvedValue(Array.from({length:205},(_,i)=>({...createApiKey(),id:i+1})))
    const wrapper=await mountView()
    const cards=wrapper.findAll('.uk-stats strong')
    expect(cards[0].text()).toBe('205')
    expect(cards[2].text()).toBe('$211.1500')
    expect(cards[3].text()).toBe('$2111.5000')
    const batches=getDashboardApiKeysUsage.mock.calls.map(c=>c[0])
    expect(batches.some(ids=>ids.length===100)).toBe(true)
    expect(batches.every(ids=>ids.length<=100)).toBe(true)
    wrapper.unmount()
  })

  it('厂商集合失败时清空列表与 total，重试可恢复', async () => {
    const wrapper=await mountView()
    vi.mocked(collectKeys).mockRejectedValueOnce(new Error('failed'))
    const vendor=wrapper.findAllComponents({name:'Select'})[0]
    vendor.vm.$emit('update:modelValue','openai');vendor.vm.$emit('change','openai')
    await flushPromises()
    expect(wrapper.findComponent({name:'DataTable'}).props('data')).toEqual([])
    expect(wrapper.find('.uk-error[role=alert]').exists()).toBe(true)
    vi.mocked(collectKeys).mockResolvedValueOnce([])
    await wrapper.get('.uk-error button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.uk-error[role=alert]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('启停走 toggleStatus，过期和额度耗尽不冒充手动禁用', async () => {
    vi.mocked(keysAPI.toggleStatus).mockResolvedValue({...createApiKey(),status:'inactive'})
    const wrapper=await mountView()
    await wrapper.get('[role=switch]').trigger('click')
    await flushPromises()
    expect(keysAPI.toggleStatus).toHaveBeenCalledWith(1,'inactive')
    wrapper.unmount()
    listKeys.mockResolvedValue({items:[{...createApiKey(),status:'expired'}],total:1,page:1,page_size:10,pages:1})
    const expired=await mountView()
    expect(expired.get('[role=switch]').attributes('disabled')).toBeDefined()
    expect(expired.get('.uk-status small').text()).toBe('Expired')
    expired.unmount()
  })

  it('正式编辑保留高级 DTO、清除有效期与限额，并执行正式删除', async () => {
    const source={...createApiKey(),group_id:1}
    listKeys.mockResolvedValue({items:[source],total:1,page:1,page_size:10,pages:1})
    updateKey.mockResolvedValue(source)
    const wrapper=await mountView()
    await getButtonByText(wrapper,'common.edit').trigger('click')
    const vm=wrapper.vm as unknown as {formData:Record<string,unknown>}
    Object.assign(vm.formData,{name:'Updated',enable_quota:true,quota:17.5,enable_ip_restriction:true,ip_whitelist:'127.0.0.1\n10.0.0.0/8',ip_blacklist:'203.0.113.1',enable_rate_limit:true,rate_limit_5h:1,rate_limit_1d:2,rate_limit_7d:3,enable_expiration:false})
    await wrapper.get('#key-form').trigger('submit');await flushPromises()
    expect(updateKey).toHaveBeenLastCalledWith(1,expect.objectContaining({name:'Updated',quota:17.5,ip_whitelist:['127.0.0.1','10.0.0.0/8'],ip_blacklist:['203.0.113.1'],rate_limit_5h:1,rate_limit_1d:2,rate_limit_7d:3,expires_at:''}))
    await getButtonByText(wrapper,'common.edit').trigger('click')
    Object.assign(vm.formData,{enable_quota:false,enable_ip_restriction:false,enable_rate_limit:false})
    await wrapper.get('#key-form').trigger('submit');await flushPromises()
    expect(updateKey).toHaveBeenLastCalledWith(1,expect.objectContaining({quota:0,ip_whitelist:[],ip_blacklist:[],rate_limit_5h:0,rate_limit_1d:0,rate_limit_7d:0}))
    vi.mocked(keysAPI.delete).mockResolvedValue({message:'ok'})
    await getButtonByText(wrapper,'common.delete').trigger('click')
    wrapper.findAllComponents({name:'ConfirmDialog'}).find(c=>c.props('title')==='keys.deleteKey')!.vm.$emit('confirm')
    await flushPromises();expect(keysAPI.delete).toHaveBeenCalledWith(1)
    wrapper.unmount()
  })

  it('切换详情时忽略上一条迟到响应', async () => {
    let resolveOld!:(value:unknown)=>void
    vi.mocked(usageAPI.getMyApiKeyDailyUsage).mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve as (value:unknown)=>void}))
    listKeys.mockResolvedValue({items:[createApiKey(),{...createApiKey(),id:2,name:'second'}],total:2,page:1,page_size:10,pages:1})
    const wrapper=await mountView()
    wrapper.findComponent({name:'DataTable'}).vm.$emit('rowClick',{...createApiKey(),id:2,name:'second'})
    await flushPromises()
    resolveOld({items:[{date:'old-data',requests:10,actual_cost:99}]})
    await flushPromises()
    expect(wrapper.get('.uk-detail-heading h2').text()).toBe('second')
    expect(wrapper.get('.uk-trend').text()).not.toContain('old-data')
    wrapper.unmount()
  })

  it('正式创建校验自定义 Key，并提交完整高级字段、额度和有效期', async () => {
    getAvailableGroups.mockResolvedValue([{id:1,name:'Allowed',platform:'openai',rate_multiplier:1}])
    const wrapper=await mountView()
    await getButtonByText(wrapper,'Create API Key').trigger('click')
    const vm=wrapper.vm as unknown as {formData:Record<string,unknown>}
    Object.assign(vm.formData,{name:'Created',group_id:1,use_custom_key:true,custom_key:'bad',quota:5.5,enable_ip_restriction:true,ip_whitelist:'127.0.0.1',ip_blacklist:'203.0.113.1',enable_rate_limit:true,rate_limit_5h:1,rate_limit_1d:2,rate_limit_7d:3,enable_expiration:true,expiration_preset:'7',expiration_date:new Date(Date.now()+6.5*86400000).toISOString()})
    await wrapper.get('#key-form').trigger('submit');await flushPromises()
    expect(keysAPI.create).not.toHaveBeenCalled()
    Object.assign(vm.formData,{custom_key:'fixture_custom_key_123456'})
    await wrapper.get('#key-form').trigger('submit');await flushPromises()
    expect(keysAPI.create).toHaveBeenCalledWith('Created',1,'fixture_custom_key_123456',['127.0.0.1'],['203.0.113.1'],5.5,7,{rate_limit_5h:1,rate_limit_1d:2,rate_limit_7d:3})
    wrapper.unmount()
  })

  it('快速变更筛选时忽略迟到的列表，不污染新结果或总数', async () => {
    const wrapper=await mountView()
    let finish!:(value:unknown)=>void
    listKeys.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
    const search=wrapper.findComponent({name:'SearchInput'})
    search.vm.$emit('update:modelValue','old');search.vm.$emit('search');await nextTick()
    listKeys.mockResolvedValueOnce({items:[{...createApiKey(),id:2,name:'new result'}],total:1,page:1,page_size:10,pages:1})
    search.vm.$emit('update:modelValue','new');search.vm.$emit('search');await flushPromises()
    finish({items:[{...createApiKey(),name:'old result'}],total:99,page:1,page_size:10,pages:10});await flushPromises()
    expect(wrapper.findComponent({name:'DataTable'}).props('data')[0].name).toBe('new result')
    expect(wrapper.findComponent({name:'Pagination'}).props('total')).toBe(1)
    wrapper.unmount()
  })

  it('目录或倍率失败时显示独立错误，主刷新重试并恢复授权目录', async () => {
    getAvailableGroups.mockRejectedValueOnce(new Error('directory unavailable'))
    getUserGroupRates.mockRejectedValueOnce(new Error('rates unavailable'))
    const wrapper=await mountView()
    expect(wrapper.find('.uk-directory-error').exists()).toBe(true)
    getAvailableGroups.mockResolvedValue([{id:1,name:'Restored',platform:'openai',rate_multiplier:1}])
    getUserGroupRates.mockResolvedValue({1:0.5})
    await wrapper.get('button[title="Refresh"]').trigger('click');await flushPromises()
    expect(getAvailableGroups).toHaveBeenCalledTimes(2)
    expect(getUserGroupRates).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.uk-directory-error').exists()).toBe(false)
    expect(wrapper.findAllComponents({name:'Select'})[1].props('options').some((g:{label:string})=>g.label==='Restored · 0.5×')).toBe(true)
    wrapper.unmount()
  })

})
