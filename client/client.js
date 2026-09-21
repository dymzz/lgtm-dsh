/**
 * lgtm-dsh — browser half.
 *
 * Renders the lgtm-dsh card inside Settings -> Plugins -> Plugin configuration.
 * A card must be registered into the `settings.plugin.item` slot, keyed by the
 * settings namespace its Host half owns (`lgtm-dsh`): the tab pairs served
 * namespaces with registered cards, and a served namespace no card claims
 * renders nothing. DSH ships no schema-driven form renderer, so the controls
 * here are drawn by hand.
 *
 * Hand-written in the module loader's lazy-CJS bundle protocol, and `require` is
 * limited to `react` — the same zero-dependency stance the host half takes.
 * There is no build step and no import from a dsh client package.
 *
 * The chrome follows `@liustack/modlens`'s card, which in turn matches the
 * built-in cards value for value — border, layer backgrounds, 12px radius, a
 * header row with a rotating chevron, a footer with a ghost discard and a
 * primary save — so this reads as a sibling of the built-in cards rather than a
 * lodger. Every colour is a `--dsw-alias-*` design token, so it follows the
 * active theme. Styles are inline rather than an injected stylesheet: one less
 * global side effect, and nothing to clean up on teardown.
 *
 * Data comes from two places:
 *   - the `lgtm-dsh` settings scope  — this plugin's own section (the user's choice);
 *   - the `llm-pi-ai` settings scope — the live model routes, which carry each
 *     route's `apiKeyEnv` reference.
 *
 * The CLI version is not a control here: it is a dependency fact, changed by
 * changing `dependencies`, not by configuring it at runtime.
 *
 * The composition layer is the other configuration channel: a patch row's
 * `config:` block is validated against the exported `Config` schema and handed to
 * the settings section as its `base`, so a deployment default and this card's
 * user layer both apply.
 */
window.__ModuleLoader__.load({
  id: 'lgtm-dsh',
  factory: (require) => {
    var module = { exports: {} };

    const react = require('react');
    const h = react.createElement;

    /** This plugin's settings namespace; must equal the Host registration. */
    const NS = 'lgtm-dsh';

    /** The namespace that owns the model routes. */
    const LLM_NS = 'llm-pi-ai';

    /** The reference lgtm itself reads out of its environment. */
    const LGTM_REF = 'TYPESAFE_API_KEY';

    /** A pi-ai route has to name this host for lgtm's key to be the right one. */
    const TYPESAFE_HOST = /(^|\.)typesafe\.ai$/i;

    /** The border every surface on this card shares. */
    const BORDER = '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))';
    const MUTED = 'var(--dsw-alias-label-secondary, inherit)';
    const FAINT = 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))';
    const DANGER = 'var(--dsw-alias-state-error-primary, #d92d20)';

    const S = {
      card: (open) => ({
        border: BORDER,
        background: open
          ? 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.10))'
          : 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.05))',
        borderRadius: '12px',
        transition: 'border-color .16s, background .16s',
      }),
      head: {
        appearance: 'none',
        width: '100%',
        font: 'inherit',
        color: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        background: 'none',
        border: 0,
        borderRadius: '12px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '14px 16px',
      },
      headText: { flex: 1, minWidth: 0 },
      title: { fontSize: '14px', fontWeight: 600 },
      subtitle: { color: FAINT, fontSize: '13px', lineHeight: 1.5 },
      chevron: (open) => ({
        width: 16,
        height: 16,
        viewBox: '0 0 16 16',
        style: {
          color: FAINT,
          flex: 'none',
          transition: 'transform .16s',
          transform: open ? 'rotate(180deg)' : 'none',
        },
      }),
      body: { margin: '0 16px', paddingBottom: '8px' },
      field: (first) => ({
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '12px 0',
        borderTop: first ? 'none' : BORDER,
      }),
      label: { fontSize: '13px', color: MUTED },
      select: {
        appearance: 'none',
        width: '100%',
        padding: '8px 12px',
        borderRadius: '8px',
        border: BORDER,
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        fontSize: '13px',
      },
      hint: { margin: 0, fontSize: '12px', lineHeight: 1.55, color: FAINT },
      note: { margin: 0, fontSize: '12px', lineHeight: 1.5, color: MUTED },
      failed: { margin: 0, fontSize: '12px', lineHeight: 1.5, color: DANGER },
      guidance: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '10px 12px',
        border: BORDER,
        borderRadius: '8px',
        fontSize: '12px',
        lineHeight: 1.6,
      },
      code: { display: 'block', whiteSpace: 'pre', fontSize: '11px', lineHeight: 1.7 },
      footer: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '12px 0 4px',
        borderTop: BORDER,
      },
      spacer: { flex: 1, minWidth: 0 },
      ghost: (disabled) => ({
        appearance: 'none',
        font: 'inherit',
        fontSize: '13px',
        lineHeight: 1.5,
        cursor: disabled ? 'default' : 'pointer',
        border: BORDER,
        borderRadius: '8px',
        padding: '5px 14px',
        background: 'transparent',
        color: 'inherit',
        opacity: disabled ? 0.4 : 1,
      }),
      primary: (enabled) => ({
        appearance: 'none',
        font: 'inherit',
        fontSize: '13px',
        lineHeight: 1.5,
        cursor: enabled ? 'pointer' : 'default',
        border: '1px solid transparent',
        borderRadius: '8px',
        padding: '5px 14px',
        background: 'var(--dsw-alias-label-primary, currentColor)',
        color: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.05))',
        opacity: enabled ? 1 : 0.4,
      }),
    };

    /**
     * Host of a route's baseURL, or undefined when it is absent or unparseable.
     * @param baseURL - the route's configured base URL.
     * @returns the hostname, or undefined.
     */
    function hostOf(baseURL) {
      if (typeof baseURL !== 'string' || baseURL.length === 0) return undefined;
      try {
        return new URL(baseURL).hostname;
      } catch {
        return undefined;
      }
    }

    /**
     * Classify one route. The plugin hands whichever reference the user picks to
     * the lgtm child process as `TYPESAFE_API_KEY`, and lgtm sends that value to
     * TypeSafe; so the endpoint decides whether the key can authenticate, and the
     * reference name only decides whether it is the one lgtm would have found on
     * its own.
     * @param profile - the route's configured profile.
     * @returns the tier, a short label, and the explanation.
     */
    function verdictFor(profile) {
      const host = hostOf(profile?.baseURL);
      if (host !== undefined && TYPESAFE_HOST.test(host)) {
        return profile.apiKeyEnv === LGTM_REF
          ? { tier: 'ready', label: '就绪', text: 'TypeSafe 端点，lgtm 直接读这个引用' }
          : { tier: 'bridge', label: '可用', text: `key 会从 ${profile.apiKeyEnv} 桥接为 ${LGTM_REF}` };
      }
      return { tier: 'foreign', label: '不匹配', text: `非 TypeSafe 端点（${host ?? '无 baseURL'}）` };
    }

    /**
     * Read the routes out of an `llm-pi-ai` snapshot.
     * @param snapshot - the settings scope snapshot.
     * @returns route entries in declaration order.
     */
    function routesOf(snapshot) {
      const providers = snapshot?.value?.providers;
      if (!providers || typeof providers !== 'object') return [];
      return Object.entries(providers).map(([route, raw]) => {
        const profile = raw ?? {};
        return { route, profile, verdict: verdictFor(profile) };
      });
    }

    /**
     * The entry the picker falls back to: an early route lgtm can actually use,
     * else simply the first declared one, so the control never renders blank.
     * @param routes - the classified routes.
     * @returns the route id to show, or the empty string.
     */
    function defaultRouteOf(routes) {
      const usable = routes.find((entry) => entry.verdict.tier === 'ready');
      return (usable ?? routes[0])?.route ?? '';
    }

    /**
     * One labelled field: label above, control below, hint below that when there
     * is one to give.
     * @param props - id, label, value, options, disabled flag, picker, first flag, optional hint.
     * @returns the element.
     */
    function field(props) {
      return h(
        'label',
        { key: props.id, style: S.field(props.first === true) },
        h('div', { style: S.label }, props.label),
        h(
          'select',
          {
            value: props.value,
            disabled: props.disabled,
            style: S.select,
            onChange: (event) => props.onPick(event.target.value),
          },
          props.options.map((option) => h('option', { key: option.id, value: option.id }, option.label)),
        ),
        props.hint === undefined ? null : h('p', { style: S.hint }, props.hint),
      );
    }

    /**
     * The guidance block shown when no route can carry lgtm's key.
     * @returns the element.
     */
    function guidance() {
      return h('div', { style: S.guidance }, [
        h('strong', { key: 'h' }, '需要添加自定义模型提供方'),
        h('div', { key: 'b' }, 'Settings → Models → 添加自定义提供方，然后填入：'),
        h(
          'code',
          { key: 'c', style: S.code },
          `apiKeyEnv: ${LGTM_REF}\nbaseURL:   https://api.typesafe.ai\napi:       任意（lgtm 不经过这条路由）\nmodel:     jev-latest`,
        ),
        h(
          'div',
          { key: 'n' },
          '这条路由只用来把 TypeSafe key 存进 DSH 凭据。lgtm 走自己的 SDK，不经过它，' +
            '所以此处的协议/端点是否正确都不影响审计。',
        ),
      ]);
    }

    /**
     * The plugin card.
     * @param props - the slot props, carrying the two bound settings scopes.
     * @returns the element.
     */
    function Card(props) {
      const own = props.own;
      const catalog = props.catalog;

      const [ownSnapshot, setOwnSnapshot] = react.useState(() => own.getSnapshot());
      const [catalogSnapshot, setCatalogSnapshot] = react.useState(() => catalog.getSnapshot());
      const [open, setOpen] = react.useState(false);
      const [draft, setDraft] = react.useState({});
      const [saving, setSaving] = react.useState(false);
      const [failed, setFailed] = react.useState(false);

      react.useEffect(() => own.subscribe(() => setOwnSnapshot(own.getSnapshot())), [own]);
      react.useEffect(() => catalog.subscribe(() => setCatalogSnapshot(catalog.getSnapshot())), [catalog]);

      // The section supplies nothing: a namespace this client cannot see shows no
      // trace, which is what an absent Host half or a remote browser means.
      if (ownSnapshot.status === 'unavailable') return null;

      const ready = ownSnapshot.status === 'ready';
      const writable = ownSnapshot.writable;
      const disabled = !ready || !writable || saving;
      const stored = ownSnapshot.value ?? {};
      // A field shows its staged draft when there is one, else the stored value.
      const value = { ...stored, ...draft };
      const dirty = Object.keys(draft).length > 0;

      const routes = routesOf(catalogSnapshot);
      const selectedRoute = value.provider || defaultRouteOf(routes);
      const readyRoutes = routes.filter((entry) => entry.verdict.tier === 'ready');

      const stage = (name, next) => {
        setFailed(false);
        setDraft((current) => ({ ...current, [name]: next }));
      };

      const pickRoute = (route) => {
        const entry = routes.find((candidate) => candidate.route === route);
        if (entry === undefined) return;
        setFailed(false);
        // Only the route is stored; the reference follows from it on both halves.
        setDraft((current) => ({ ...current, provider: entry.route }));
      };

      const discard = () => {
        setDraft({});
        setFailed(false);
      };

      const save = async () => {
        if (!dirty || saving) return;
        setSaving(true);
        setFailed(false);
        try {
          for (const [name, next] of Object.entries(draft)) await own.set(name, next);
          setDraft({});
          setOpen(false);
        } catch {
          setFailed(true);
        } finally {
          setSaving(false);
        }
      };

      // Normal state stays quiet; the credential hint only appears when an audit
      // would actually be blocked.
      const subtitle =
        readyRoutes.length > 0
          ? '添加lgtm（使用typesafe Jev 测试）'
          : '添加lgtm（使用typesafe Jev 测试） · 需要一个 TypeSafe 凭据';

      return h('div', { style: S.card(open) }, [
        h(
          'button',
          {
            key: 'head',
            type: 'button',
            'aria-expanded': open,
            onClick: () => setOpen((current) => !current),
            style: S.head,
          },
          h('div', { key: 'text', style: S.headText }, [
            h('div', { key: 't', style: S.title }, 'lgtm-dsh'),
            h('div', { key: 's', style: S.subtitle }, subtitle),
          ]),
          // Inline chevron: the built-in cards rotate one, and drawing four
          // points costs less than depending on an icon package.
          h(
            'svg',
            { key: 'c', ...S.chevron(open) },
            h('path', {
              d: 'M4 6l4 4 4-4',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.5,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
            }),
          ),
        ),

        !open
          ? null
          : h('div', { key: 'body', style: S.body }, [
              !ready ? h('p', { key: 'loading', style: S.note, role: 'status' }, '正在读取设置…') : null,
              ready && !writable
                ? h('p', { key: 'ro', style: S.note, role: 'status' }, '这个部署不接受设置写入。')
                : null,

              field({
                id: 'route',
                first: true,
                label: '模型路由',
                value: selectedRoute,
                options: routes.map((entry) => ({
                  id: entry.route,
                  label: `${entry.profile.displayName ?? entry.route} — ${entry.verdict.label}`,
                })),
                disabled: disabled || routes.length === 0,
                onPick: pickRoute,
              }),

              readyRoutes.length === 0 ? h('div', { key: 'g' }, guidance()) : null,

              h('div', { key: 'footer', style: S.footer }, [
                failed
                  ? h('p', { key: 'f', style: S.failed, role: 'status' }, '保存失败，草稿已保留。')
                  : h('p', { key: 'n', style: S.note }, dirty ? '未保存' : ''),
                h('div', { key: 'sp', style: S.spacer }),
                h(
                  'button',
                  {
                    key: 'discard',
                    type: 'button',
                    disabled: !dirty || saving,
                    onClick: discard,
                    style: S.ghost(!dirty || saving),
                  },
                  '放弃',
                ),
                h(
                  'button',
                  {
                    key: 'save',
                    type: 'button',
                    disabled: !dirty || saving,
                    onClick: save,
                    style: S.primary(dirty && !saving),
                  },
                  saving ? '保存中…' : '保存',
                ),
              ]),
            ]),
      ]);
    }

    /**
     * Register the card under this plugin's settings namespace.
     *
     * `slots` and `settingsScope` are declared here rather than discovered inside
     * a nested `ctx.inject`, which is the shape the settings-card cookbook uses.
     *
     * The registration carries `name` and `key` and nothing else: the slot
     * contract declares exactly one register option, and a keyed entry must not
     * claim `order` — card order is registration order.
     * @param ctx - the browser-side Cordis context.
     */
    function apply(ctx) {
      const own = ctx.settingsScope.bind({ namespace: NS });
      const catalog = ctx.settingsScope.bind({ namespace: LLM_NS });
      ctx.slots.inject('settings.plugin.item', () =>
        ctx.slots.register(
          {
            name: 'settings.plugin.item',
            // The dispatch key: the tab pairs it with the settings namespace the
            // Host serves, and a key the Host does not serve renders nothing.
            key: NS,
            inject: () => ({ own, catalog }),
          },
          Card,
        ),
      );
    }

    module.exports = { name: 'lgtm-dsh', inject: ['slots', 'settingsScope'], apply };
    return module.exports;
  },
});
