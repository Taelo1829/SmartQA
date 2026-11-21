/**
 * In-browser page analysis.
 *
 * `collectPageSnapshot` is serialised and executed inside the page by
 * Playwright. It therefore must be completely self-contained: no imports, no
 * references to module scope. Everything it needs is defined inside it.
 *
 * It is deliberately framework-agnostic: no assumption about React/Vue/Angular
 * or about class names. Selection is based on roles, native semantics,
 * accessibility attributes and visibility.
 */

export interface RawElement {
  selector: string;
  fallbackSelectors: string[];
  tag: string;
  role: string | null;
  label: string;
  category: string;
  testId: string | null;
  elementId: string | null;
  href: string | null;
  inputType: string | null;
  name: string | null;
  box: { x: number; y: number; width: number; height: number } | null;
  disabled: boolean;
  expanded: string | null;
  pressed: string | null;
  checked: boolean | null;
  value: string | null;
}

export interface RawFilterOption {
  label: string;
  value: string | null;
  selector: string;
  index: number;
  checked: boolean;
}

export interface RawFilter {
  label: string;
  kind: string;
  selector: string;
  multiple: boolean;
  optionSource: string;
  options: RawFilterOption[];
}

export interface RawMetric {
  label: string;
  rawText: string;
  value: number | null;
  unit: string | null;
  selector: string;
  scope: string;
  groupKey: string | null;
}

export interface RawTable {
  headers: string[];
  rows: string[][];
  /** DOM rows in tbody, including skeleton and empty-state rows. */
  rowCount: number;
  /** Rows that actually look like data rows (same cell count as the header, no colspan). */
  dataRowCount?: number;
  footer: string[];
  page: number | null;
  totalPages: number | null;
  paginationLabel: string | null;
}

export interface RawSentinel {
  token: string;
  text: string;
  selector: string;
  isolated: boolean;
  context: string;
  tag: string;
}

export interface RawOverflow {
  scrollWidth: number;
  clientWidth: number;
  offenders: Array<{ selector: string; tag: string; text: string; right: number; width: number }>;
}

export interface RawOverlap {
  a: { selector: string; label: string; tag: string };
  b: { selector: string; label: string; tag: string };
  ratio: number;
}

export interface RawSpinner {
  selector: string;
  label: string;
  visible: boolean;
}

export interface RawModal {
  selector: string;
  text: string;
  role: string | null;
}

export interface PageSnapshot {
  url: string;
  title: string;
  readyState: string;
  mainText: string;
  bodyTextLength: number;
  elements: RawElement[];
  filters: RawFilter[];
  metrics: RawMetric[];
  tables: RawTable[];
  links: Array<{ href: string; label: string }>;
  images: Array<{ src: string; alt: string; broken: boolean; visible: boolean }>;
  sentinels: RawSentinel[];
  overflow: RawOverflow;
  overlaps: RawOverlap[];
  spinners: RawSpinner[];
  emptyStateText: string | null;
  modal: RawModal | null;
  domSignature: string;
  elementCount: number;
}

export function collectPageSnapshot(): PageSnapshot {
  const MAX_ELEMENTS = 220;
  const MAX_TEXT = 4000;

  function isVisible(el: Element): boolean {
    const rect = el.getBoundingClientRect();
    if (rect.width < 3 || rect.height < 3) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const vh = window.innerHeight || 1;
    const vw = window.innerWidth || 1;
    if (rect.bottom < -200 || rect.top > vh + 2000) return false;
    if (rect.right < -50 || rect.left > vw + 50) return false;
    return true;
  }

  function cssEscape(value: string): string {
    const w = window as unknown as { CSS?: { escape?: (v: string) => string } };
    if (w.CSS && typeof w.CSS.escape === 'function') return w.CSS.escape(value);
    return value.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
  }

  function uniqueSelector(el: Element): string {
    const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-test');
    if (testId) return `[data-testid="${testId.replace(/"/g, '\\"')}"]`;
    if (el.id && document.querySelectorAll(`#${cssEscape(el.id)}`).length === 1) return `#${cssEscape(el.id)}`;
    const name = el.getAttribute('name');
    if (name && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) {
      const matches = document.querySelectorAll(`${el.tagName.toLowerCase()}[name="${name.replace(/"/g, '\\"')}"]`);
      if (matches.length === 1) return `${el.tagName.toLowerCase()}[name="${name.replace(/"/g, '\\"')}"]`;
    }
    const aria = el.getAttribute('aria-label');
    if (aria) {
      const candidate = `${el.tagName.toLowerCase()}[aria-label="${aria.replace(/"/g, '\\"')}"]`;
      try {
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      } catch {
        /* invalid selector, fall through */
      }
    }
    const parts: string[] = [];
    let node: Element | null = el;
    let depth = 0;
    while (node && node !== document.body && depth < 7) {
      let part = node.tagName.toLowerCase();
      const parent: Element | null = node.parentElement;
      if (!parent) break;
      const siblings = Array.prototype.filter.call(parent.children, (child: Element) => child.tagName === node!.tagName);
      if (siblings.length > 1) {
        const index = Array.prototype.indexOf.call(siblings, node) + 1;
        part += `:nth-of-type(${index})`;
      }
      parts.unshift(part);
      const selector = parts.join(' > ');
      try {
        if (document.querySelectorAll(selector).length === 1) return selector;
      } catch {
        /* keep building */
      }
      node = parent;
      depth += 1;
    }
    return parts.length ? `body > ${parts.join(' > ')}` : el.tagName.toLowerCase();
  }

  function textOf(el: Element | null | undefined, max = 140): string {
    if (!el) return '';
    const text = ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function labelFor(el: Element): string {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/)
        .map((id) => textOf(document.getElementById(id), 80))
        .filter(Boolean);
      if (parts.length) return parts.join(' ').trim();
    }
    const native = el as HTMLInputElement;
    if (native.labels && native.labels.length > 0) {
      const labelText = textOf(native.labels[0], 100);
      if (labelText) return labelText;
    }
    const own = textOf(el, 120);
    if (own) return own;
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder;
    const title = el.getAttribute('title');
    if (title) return title;
    const alt = el.getAttribute('alt');
    if (alt) return alt;
    const name = el.getAttribute('name');
    if (name) return name;
    const value = (el as HTMLInputElement).value;
    if (value) return value;
    return el.tagName.toLowerCase();
  }

  function categoryFor(el: Element): string {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const text = textOf(el, 80).toLowerCase();
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';
    if (tag === 'input') {
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'search' || role === 'searchbox') return 'search';
      return 'input';
    }
    if (role === 'tab') return 'tab';
    if (role === 'menuitem') return 'menuitem';
    if (role === 'checkbox') return 'checkbox';
    if (role === 'radio') return 'radio';
    if (role === 'combobox') return 'combobox';
    if (role === 'searchbox') return 'search';
    if (tag === 'summary') return 'accordion';
    if (el.getAttribute('aria-expanded') !== null) return 'accordion';
    if (el.closest('[role="menu"], [role="menubar"]')) return 'menuitem';
    if (el.closest('[role="tablist"]')) return 'tab';
    if (tag === 'a' && el.getAttribute('href')) {
      if (/^(next|prev|previous|»|«|›|‹)/i.test(text) || /page \d+/i.test(text)) return 'pagination';
      return 'link';
    }
    if (/\b(next|previous|prev|page \d+|»|«|›|‹)\b/i.test(text)) return 'pagination';
    if (el.closest('fieldset, [role="group"], form')) {
      if (el.getAttribute('aria-pressed') !== null) return 'filter';
    }
    return 'button';
  }

  /**
   * Only real controls should enter the action graph. Decorative containers with
   * a data-testid (KPI cards, forms, status panels) previously became "buttons"
   * and produced overlap false positives.
   */
  function isInteractiveElement(el: Element): boolean {
    const tag = el.tagName;
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (tag === 'A') return el.hasAttribute('href');
    if (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'].includes(tag)) return true;
    if (
      /^(button|tab|menuitem|menuitemcheckbox|menuitemradio|checkbox|radio|switch|combobox|searchbox|slider|spinbutton|treeitem|option)$/.test(
        role,
      )
    ) {
      return true;
    }
    if (el.hasAttribute('aria-expanded') || el.hasAttribute('onclick') || el.hasAttribute('data-filter-value')) {
      return true;
    }
    return (el as HTMLElement).tabIndex >= 0;
  }

  function parseNumber(text: string): { value: number; unit: string | null } | null {
    const clean = text.replace(/\u00a0/g, ' ').trim();
    const percent = clean.match(/(-?\d[\d\s,.]*)\s*%/);
    const currency = clean.match(/(?:R|\$|€|£|¥)\s*(-?\d[\d\s,.]*)/);
    const plain = clean.match(/-?\d[\d\s,.]*\d|-?\d/);
    const match = percent || currency || plain;
    if (!match) return null;
    // "ORDER-1001" and "Q4" contain numbers, but they are identifiers, not
    // metrics. Match the stricter Node-side parser unless a currency/percent
    // prefix makes the numeric intent explicit.
    if (!percent && !currency) {
      const index = clean.indexOf(match[0]);
      const before = clean.slice(0, index);
      const after = clean.slice(index + match[0].length);
      if (/[a-z]$/i.test(before) || /^[a-z]/i.test(after)) return null;
    }
    let raw = match[1] !== undefined ? match[1] : match[0];
    raw = raw.replace(/\s/g, '');
    if (raw.includes(',') && raw.includes('.')) raw = raw.replace(/,/g, '');
    else if (raw.includes(',')) {
      const parts = raw.split(',');
      raw = parts.length === 2 && parts[1].length === 3 ? parts.join('') : parts.join('.');
    }
    if ((raw.match(/\./g) || []).length > 1) raw = raw.replace(/\.(?=.*\.)/g, '');
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) return null;
    let unit: string | null = null;
    if (percent) unit = '%';
    else if (clean.includes('R')) unit = 'R';
    else if (clean.includes('$')) unit = '$';
    else if (clean.includes('€')) unit = '€';
    else if (clean.includes('£')) unit = '£';
    return { value, unit };
  }

  function structuralHash(root: Element): string {
    let hash = 0x811c9dc5;
    function mix(value: string): void {
      for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
      }
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode as Element | null;
    let count = 0;
    while (node && count < 700) {
      const tag = node.tagName.toLowerCase();
      if (!['script', 'style', 'noscript', 'svg', 'path'].includes(tag)) {
        mix(tag);
        const role = node.getAttribute('role');
        if (role) mix(`:${role}`);
        const ariaLabel = node.getAttribute('aria-label');
        if (ariaLabel) mix(`[${ariaLabel.slice(0, 40)}]`);
        const ownText = Array.prototype.filter
          .call(node.childNodes, (child: Node) => child.nodeType === 3)
          .map((child: Node) => (child.textContent || '').trim())
          .join(' ')
          .replace(/\s+/g, ' ')
          .slice(0, 80);
        if (ownText) mix(`=${ownText}`);
        count += 1;
      }
      node = walker.nextNode() as Element | null;
    }
    return (hash >>> 0).toString(36);
  }

  const result: PageSnapshot = {
    url: location.href,
    title: document.title || '',
    readyState: document.readyState,
    mainText: '',
    bodyTextLength: 0,
    elements: [],
    filters: [],
    metrics: [],
    tables: [],
    links: [],
    images: [],
    sentinels: [],
    overflow: { scrollWidth: 0, clientWidth: 0, offenders: [] },
    overlaps: [],
    spinners: [],
    emptyStateText: null,
    modal: null,
    domSignature: '',
    elementCount: document.querySelectorAll('*').length,
  };

  const main = (document.querySelector('main, [role="main"], #main, .main') as Element | null) || document.body;
  if (!main) return result;
  result.mainText = textOf(main, MAX_TEXT);
  result.bodyTextLength = (document.body.innerText || '').trim().length;

  // ---------------------------------------------------------------- elements
  const candidateSelector = [
    'a[href]',
    'button',
    '[role="button"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="combobox"]',
    '[role="option"]',
    '[role="treeitem"]',
    '[aria-expanded]',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    'summary',
    '[data-testid]',
    '[onclick]',
  ].join(',');

  const seen = new Set<Element>();
  const rawCandidates = Array.prototype.slice.call(document.querySelectorAll(candidateSelector)) as Element[];
  for (const el of rawCandidates) {
    if (result.elements.length >= MAX_ELEMENTS) break;
    if (seen.has(el)) continue;
    seen.add(el);
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'meta', 'link'].includes(tag)) continue;
    const rect = el.getBoundingClientRect();
    const disabled = (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true';
    if (!isVisible(el) || disabled || !isInteractiveElement(el)) continue;
    const selector = uniqueSelector(el);
    const fallback: string[] = [];
    if (el.id && !selector.startsWith('#')) fallback.push(`#${cssEscape(el.id)}`);
    const aria = el.getAttribute('aria-label');
    if (aria && !selector.includes('aria-label')) fallback.push(`${tag}[aria-label="${aria.replace(/"/g, '\\"')}"]`);
    const elementText = textOf(el, 80);
    if (elementText && tag !== 'select' && tag !== 'textarea') {
      fallback.push(`text=${JSON.stringify(elementText.slice(0, 60))}`);
    }
    result.elements.push({
      selector,
      fallbackSelectors: fallback.slice(0, 3),
      tag,
      role: el.getAttribute('role'),
      label: labelFor(el),
      category: categoryFor(el),
      testId: el.getAttribute('data-testid'),
      elementId: el.id || null,
      href: el.getAttribute('href'),
      inputType: el.getAttribute('type'),
      name: el.getAttribute('name'),
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      disabled: false,
      expanded: el.getAttribute('aria-expanded'),
      pressed: el.getAttribute('aria-pressed'),
      checked:
        tag === 'input' && (el.getAttribute('type') === 'checkbox' || el.getAttribute('type') === 'radio')
          ? (el as HTMLInputElement).checked
          : null,
      value:
        tag === 'input' || tag === 'textarea' || tag === 'select'
          ? String((el as HTMLInputElement).value ?? '').slice(0, 120)
          : null,
    });
  }

  // ----------------------------------------------------------------- filters
  function filterish(label: string, container: Element | null): boolean {
    const haystack = [
      label,
      container?.getAttribute('aria-label') || '',
      container?.id || '',
      typeof container?.className === 'string' ? container.className : '',
    ]
      .join(' ')
      .toLowerCase();
    return /filter|region|country|city|year|month|status|category|type|department|segment|channel|product|group|sort|date|range/.test(
      haystack,
    );
  }

  const filterContainers = new Set<Element>();
  const selects = Array.prototype.slice.call(
    document.querySelectorAll('select:not([disabled])'),
  ) as HTMLSelectElement[];
  for (const select of selects) {
    if (!isVisible(select)) continue;
    const options = Array.prototype.slice.call(select.options) as HTMLOptionElement[];
    if (options.length < 2) continue;
    const label = labelFor(select);
    if (/per\s*page|page\s*size|rows?\s*(per|:)|\bsort\b/i.test(label)) continue;
    const container = select.closest('fieldset, form, [role="group"], .filters, [data-filters], aside');
    if (!filterish(label, container) && options.length < 3) continue;
    filterContainers.add(container || select);
    result.filters.push({
      label,
      kind: 'select',
      selector: uniqueSelector(select),
      multiple: select.multiple,
      optionSource: 'options',
      options: options
        .slice(0, 40)
        .map((option, index) => ({
          label: (option.textContent || option.value || '').trim(),
          value: option.value,
          selector: `${uniqueSelector(select)} >> option:nth-child(${index + 1})`,
          index,
          checked: option.selected,
        }))
        .filter((option) => !/^(-{2,}|select|all|choose)/i.test(option.label)),
    });
  }

  const checkboxGroups = new Map<string, HTMLInputElement[]>();
  const radios = Array.prototype.slice.call(
    document.querySelectorAll('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]'),
  ) as HTMLInputElement[];
  for (const input of radios) {
    if (!isVisible(input) || input.disabled) continue;
    const isRadio = input.getAttribute('type') === 'radio' || input.getAttribute('role') === 'radio';
    if (isRadio) continue; // handled per group below
    const container = input.closest('fieldset, [role="group"], [data-filters], .filters, form') || input.parentElement;
    if (!container) continue;
    const label = labelFor(input);
    if (!filterish(label, container) && !container.querySelector('legend, [data-filter-label]')) continue;
    const key = container.id || container.className || 'group';
    const list = checkboxGroups.get(`cb:${key}`) || [];
    list.push(input);
    checkboxGroups.set(`cb:${key}`, list);
  }

  const radioGroups = new Map<string, HTMLInputElement[]>();
  for (const input of radios) {
    if (!isVisible(input) || input.disabled) continue;
    const isRadio = input.getAttribute('type') === 'radio' || input.getAttribute('role') === 'radio';
    if (!isRadio) continue;
    const name = input.getAttribute('name') || 'radio-group';
    const container = input.closest('[role="radiogroup"], fieldset, [data-filters], .filters, form');
    const label = labelFor(input);
    if (!filterish(label, container) && !name.toLowerCase().includes('filter')) continue;
    const list = radioGroups.get(name) || [];
    list.push(input);
    radioGroups.set(name, list);
  }

  function groupLabel(container: Element | null, fallback: string): string {
    if (!container) return fallback;
    const legend = container.querySelector('legend');
    if (legend) return textOf(legend, 60);
    const dataLabel = container.getAttribute('data-filter-label') || container.getAttribute('aria-label');
    if (dataLabel) return dataLabel;
    const heading = container.querySelector('h1,h2,h3,h4,h5,h6,label,.label');
    if (heading) return textOf(heading, 60);
    return fallback;
  }

  for (const [key, inputs] of checkboxGroups) {
    if (inputs.length < 2) continue;
    const container = inputs[0].closest('fieldset, [role="group"], [data-filters], .filters, form') || inputs[0].parentElement;
    const label = groupLabel(container, 'Options');
    result.filters.push({
      label,
      kind: 'checkbox_group',
      selector: uniqueSelector(container || inputs[0]),
      multiple: true,
      optionSource: 'checkboxes',
      options: inputs.slice(0, 30).map((input, index) => ({
        label: labelFor(input),
        value: input.value,
        selector: uniqueSelector(input),
        index,
        checked: input.checked,
      })),
    });
    void key;
  }

  for (const [name, inputs] of radioGroups) {
    if (inputs.length < 2) continue;
    const container = inputs[0].closest('[role="radiogroup"], fieldset, [data-filters], .filters, form') || inputs[0].parentElement;
    result.filters.push({
      label: groupLabel(container, name),
      kind: 'radio_group',
      selector: uniqueSelector(container || inputs[0]),
      multiple: false,
      optionSource: 'radios',
      options: inputs.slice(0, 30).map((input, index) => ({
        label: labelFor(input),
        value: input.value,
        selector: uniqueSelector(input),
        index,
        checked: input.checked,
      })),
    });
  }

  // Toggle-button filter groups (aria-pressed / data-active inside one container).
  const pressedButtons = Array.prototype.slice.call(
    document.querySelectorAll('button[aria-pressed], [role="button"][aria-pressed], [data-filter-value]'),
  ) as HTMLButtonElement[];
  const toggleGroups = new Map<Element, HTMLButtonElement[]>();
  for (const button of pressedButtons) {
    if (!isVisible(button)) continue;
    const container = button.closest('[role="group"], [data-filters], .filters, fieldset, .segmented, .tabs');
    if (!container) continue;
    if (!filterish(groupLabel(container, ''), container)) continue;
    const list = toggleGroups.get(container) || [];
    list.push(button);
    toggleGroups.set(container, list);
  }
  for (const [container, buttons] of toggleGroups) {
    if (buttons.length < 2) continue;
    result.filters.push({
      label: groupLabel(container, 'Options'),
      kind: 'toggle_group',
      selector: uniqueSelector(container),
      multiple: true,
      optionSource: 'buttons',
      options: buttons.slice(0, 30).map((button, index) => ({
        label: labelFor(button),
        value: button.getAttribute('data-filter-value') || button.getAttribute('aria-label'),
        selector: uniqueSelector(button),
        index,
        checked: button.getAttribute('aria-pressed') === 'true',
      })),
    });
  }

  // ----------------------------------------------------------------- metrics
  const metricSelectors = [
    '[data-metric]',
    '[data-testid*="metric"]',
    '[data-testid*="kpi"]',
    '[data-testid*="total"]',
    '[data-testid*="stat"]',
    '.metric',
    '.kpi',
    '.stat',
    '.card',
    'dd',
    'td',
    'th',
    'strong',
    'b',
    'span',
    'p',
    'h1',
    'h2',
    'h3',
  ];
  const metricSeen = new Set<string>();
  const metricNodes = Array.prototype.slice.call(document.querySelectorAll(metricSelectors.join(','))) as Element[];
  for (const node of metricNodes) {
    if (result.metrics.length >= 80) break;
    if (!isVisible(node) || node.closest('tfoot')) continue;
    const directText = Array.prototype.filter
      .call(node.childNodes, (child: Node) => child.nodeType === 3)
      .map((child: Node) => child.textContent || '')
      .join(' ')
      .trim();
    const fullText = textOf(node, 100);
    if (!fullText || fullText.length > 90) continue;
    if (/©|\bcopyright\b|\bdemo environment\b/i.test(fullText)) continue;
    const numberSource = directText || fullText;
    if (/^\s*(page|showing|rows?\s*per)\b/i.test(numberSource.trim())) continue;
    if (!/\d/.test(numberSource)) continue;
    const parsed = parseNumber(numberSource);
    if (!parsed) continue;
    if (/^(19|20)\d{2}$/.test(numberSource.trim())) continue;
    const label = (() => {
      const explicit = node.getAttribute('data-label') || node.getAttribute('aria-label');
      if (explicit) return explicit.trim();
      const parent = node.parentElement;
      const siblings = parent ? Array.prototype.slice.call(parent.children) : [];
      const index = siblings.indexOf(node);
      for (let i = index - 1; i >= 0; i -= 1) {
        const candidate = textOf(siblings[i], 60);
        if (candidate && !/\d/.test(candidate)) return candidate;
      }
      if (parent) {
        const heading = parent.querySelector('h1,h2,h3,h4,h5,h6,.label,[data-label]');
        if (heading && heading !== node) {
          const text = textOf(heading, 60);
          if (text) return text;
        }
      }
      if (node.tagName === 'TD' || node.tagName === 'TH') {
        const cell = node as HTMLTableCellElement;
        const header = cell.closest('table')?.querySelector('thead tr')?.children[cell.cellIndex];
        if (header) return textOf(header, 60);
      }
      return '';
    })();
    if (!label) continue;
    const scope =
      node.tagName === 'TD' || node.tagName === 'TH'
        ? 'table_row'
        : /total|grand total|overall/i.test(label) || node.closest('tfoot')
          ? 'table_total'
          : 'kpi';
    const key = `${label.toLowerCase()}::${parsed.value}`;
    if (metricSeen.has(key)) continue;
    metricSeen.add(key);
    // A list of related values (for example a regional breakdown) is a useful
    // arithmetic group even when the site has no explicit data attributes.
    const groupElement = node.closest('[data-filter-value], [data-group], li, [role="listitem"]');
    const groupKey =
      groupElement?.getAttribute('data-filter-value') ||
      groupElement?.getAttribute('data-group') ||
      (groupElement ? `list:${uniqueSelector(groupElement.parentElement ?? groupElement)}` : null);
    result.metrics.push({
      label: label.replace(/\s+/g, ' ').trim().slice(0, 80),
      rawText: numberSource.trim().slice(0, 60),
      value: parsed.value,
      unit: parsed.unit,
      selector: uniqueSelector(node),
      scope,
      groupKey,
    });
  }

  // ------------------------------------------------------------------ tables
  const tables = Array.prototype.slice.call(document.querySelectorAll('table')) as HTMLTableElement[];
  for (const table of tables.slice(0, 3)) {
    if (!isVisible(table)) continue;
    const headers = Array.prototype.slice
      .call(table.querySelectorAll('thead th'))
      .map((th: Element) => textOf(th, 50));
    const bodyRows = Array.prototype.slice.call(table.querySelectorAll('tbody tr')) as HTMLTableRowElement[];
    const rows = bodyRows.slice(0, 40).map((row) =>
      Array.prototype.slice.call(row.children).map((cell: Element) => textOf(cell, 60)),
    );
    const dataRowCount = bodyRows.reduce((count, row) => {
      const cells = Array.prototype.slice.call(row.children) as HTMLTableCellElement[];
      const spansColumns = cells.some((cell) => cell.colSpan > 1);
      const expected = headers.length > 0 ? headers.length : 2;
      return !spansColumns && cells.length === expected ? count + 1 : count;
    }, 0);
    const footer = Array.prototype.slice
      .call(table.querySelectorAll('tfoot td, tfoot th'))
      .map((cell: Element) => textOf(cell, 60));
    const pagination = table.closest('section, div')?.querySelector(
      '[aria-label*="pagination" i], .pagination, [data-pagination]',
    );
    const pageMatch = (pagination ? textOf(pagination, 80) : '').match(/page\s+(\d+)\s*(?:of|\/)\s*(\d+)/i);
    result.tables.push({
      headers,
      rows,
      rowCount: bodyRows.length,
      dataRowCount,
      footer,
      page: pageMatch ? Number(pageMatch[1]) : null,
      totalPages: pageMatch ? Number(pageMatch[2]) : null,
      paginationLabel: pagination ? textOf(pagination, 80) : null,
    });
  }

  // ------------------------------------------------------------------- links
  for (const anchor of Array.prototype.slice.call(document.querySelectorAll('a[href]')).slice(0, 120) as HTMLAnchorElement[]) {
    if (!isVisible(anchor)) continue;
    result.links.push({ href: anchor.href, label: textOf(anchor, 70) });
  }

  // ------------------------------------------------------------------ images
  for (const img of Array.prototype.slice.call(document.querySelectorAll('img')).slice(0, 80) as HTMLImageElement[]) {
    const visible = isVisible(img);
    const broken = img.complete && img.naturalWidth === 0 && Boolean(img.currentSrc || img.src);
    result.images.push({ src: img.currentSrc || img.src, alt: img.alt || '', broken, visible });
  }

  // --------------------------------------------------------------- sentinels
  const tokens = ['nan', 'undefined', 'null', 'infinity', '-infinity'];
  const tokenAlternation = tokens
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((token) => token.replace('-', '\\-'))
    .join('|');
  // The optional currency prefix catches values such as "Rundefined", which is
  // what a template literal produces when a formatted total is undefined.
  const tokenPattern = new RegExp(
    `(^|[^a-z0-9])(?:([Rr]|\\$|€|£|¥|CHF|USD|EUR|ZAR)\\s*)?(${tokenAlternation})(?![a-z0-9])`,
    'i',
  );
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();
  let sentinelCount = 0;
  while (textNode && sentinelCount < 40) {
    const content = (textNode.textContent || '').trim();
    if (content && content.length <= 120 && tokenPattern.test(content)) {
      const parent = textNode.parentElement;
      if (
        parent &&
        !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(parent.tagName) &&
        isVisible(parent)
      ) {
        const normalized = content.replace(/\s+/g, ' ').trim();
        const tokenMatch = normalized.match(tokenPattern);
        const hasCurrencyPrefix = Boolean(tokenMatch?.[2]);
        const isolated =
          hasCurrencyPrefix ||
          tokens.some((token) => normalized.toLowerCase() === token) ||
          /^[^a-zA-Z0-9]{0,3}(nan|undefined|null|-?infinity)[^a-zA-Z0-9]{0,3}$/i.test(normalized);
        result.sentinels.push({
          token: (tokenMatch ? tokenMatch[3] : normalized).toLowerCase(),
          text: normalized.slice(0, 80),
          selector: uniqueSelector(parent),
          isolated,
          context: textOf(parent.parentElement || parent, 160),
          tag: parent.tagName.toLowerCase(),
        });
        sentinelCount += 1;
      }
    }
    textNode = walker.nextNode();
  }

  // ----------------------------------------------------------------- overflow
  const docEl = document.documentElement;
  result.overflow.scrollWidth = docEl.scrollWidth;
  result.overflow.clientWidth = docEl.clientWidth;
  if (docEl.scrollWidth > docEl.clientWidth + 2) {
    const all = Array.prototype.slice.call(document.querySelectorAll('body *')) as Element[];
    for (const el of all) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 10) continue;
      if (rect.right > docEl.clientWidth + 2 && isVisible(el)) {
        const style = window.getComputedStyle(el);
        if (style.position === 'fixed') continue;
        result.overflow.offenders.push({
          selector: uniqueSelector(el),
          tag: el.tagName.toLowerCase(),
          text: textOf(el, 60),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        });
        if (result.overflow.offenders.length >= 6) break;
      }
    }
  }

  // ----------------------------------------------------------------- overlaps
  const clickable = result.elements
    .filter((el) => el.box && ['button', 'link', 'tab', 'filter', 'input', 'select', 'checkbox', 'radio'].includes(el.category))
    .slice(0, 50);
  for (let i = 0; i < clickable.length && result.overlaps.length < 5; i += 1) {
    for (let j = i + 1; j < clickable.length; j += 1) {
      const a = clickable[i];
      const b = clickable[j];
      if (!a.box || !b.box) continue;
      const left = Math.max(a.box.x, b.box.x);
      const right = Math.min(a.box.x + a.box.width, b.box.x + b.box.width);
      const top = Math.max(a.box.y, b.box.y);
      const bottom = Math.min(a.box.y + a.box.height, b.box.y + b.box.height);
      if (right <= left || bottom <= top) continue;
      const intersection = (right - left) * (bottom - top);
      const smaller = Math.min(a.box.width * a.box.height, b.box.width * b.box.height);
      const ratio = smaller > 0 ? intersection / smaller : 0;
      if (ratio > 0.45) {
        result.overlaps.push({
          a: { selector: a.selector, label: a.label, tag: a.tag },
          b: { selector: b.selector, label: b.label, tag: b.tag },
          ratio: Math.round(ratio * 100) / 100,
        });
        break;
      }
    }
  }

  // ----------------------------------------------------------------- spinners
  const spinnerSelectors = [
    '[role="progressbar"]',
    '[aria-busy="true"]',
    '.spinner',
    '.loader',
    '.loading',
    '[data-loading]',
    '[data-testid*="loading"]',
  ].join(',');
  for (const spinner of Array.prototype.slice.call(document.querySelectorAll(spinnerSelectors)).slice(0, 10) as Element[]) {
    result.spinners.push({
      selector: uniqueSelector(spinner),
      label: textOf(spinner, 60) || 'loading indicator',
      visible: isVisible(spinner),
    });
  }
  if (result.spinners.length === 0) {
    const loadingText = /^\s*loading(\.\.\.|…)?\s*$/i;
    const all = Array.prototype.slice.call(document.querySelectorAll('div, span, p, section')).slice(0, 300) as Element[];
    for (const el of all) {
      const text = textOf(el, 40);
      if (text && loadingText.test(text) && isVisible(el)) {
        result.spinners.push({ selector: uniqueSelector(el), label: text, visible: true });
        if (result.spinners.length >= 3) break;
      }
    }
  }

  const emptyPattern = /(no (data|results|records|items|rows|transactions|sales)\b|nothing to show|no matching|empty state|start by adding)/i;
  const mainText = (main as HTMLElement).innerText || main.textContent || '';
  const emptyMatch = mainText.match(emptyPattern);
  if (emptyMatch) result.emptyStateText = emptyMatch[0];

  const dialog = (Array.prototype.slice.call(
    document.querySelectorAll('[role="dialog"], [aria-modal="true"]'),
  ) as Element[]).find((el) => isVisible(el));
  if (dialog) {
    result.modal = {
      selector: uniqueSelector(dialog),
      text: textOf(dialog, 240),
      role: dialog.getAttribute('role'),
    };
  }

  result.domSignature = structuralHash(main);
  return result;
}
