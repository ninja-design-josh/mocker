# Bento Component Reference (v1)

Canonical HTML snippets for NinjaCat's Bento design system. This file is
read by the remix agent when the "Use Bento" toggle is on. Copy these
snippets into `page.html` — do not import Vue components, do not add
`<link>` or `<style>` tags for Bento (the worker injects styles after
you finish editing).

Every element uses a `.bento-*` class and every inline value (where
used) references `var(--bento-*)` tokens.

---

## Button

**When to use.** Primary actions (Submit, Save, Continue) use `--primary`.
Secondary/dismiss actions (Cancel, Back) use `--secondary`. Destructive
actions (Delete, Remove) use `--danger`. Low-emphasis or tertiary actions
use `--ghost`. Default size is 44px tall (`h-11` equivalent); use `--sm`
for a 32px control. Default size has no modifier; only add `--sm` or
`--lg` when explicitly needed.

**Canonical HTML.**

```html
<button type="button" class="bento-button bento-button--primary">Continue</button>
```

**Variants.**

```html
<button type="button" class="bento-button bento-button--secondary">Cancel</button>
<button type="button" class="bento-button bento-button--ghost">Skip</button>
<button type="button" class="bento-button bento-button--danger">Delete</button>
<button type="button" class="bento-button bento-button--primary bento-button--sm">Small primary</button>
<button type="button" class="bento-button bento-button--primary bento-button--lg">Large primary</button>
<button type="button" class="bento-button bento-button--primary" disabled>Disabled</button>
```

**Tokens it leans on.** `--bento-color-blue-100`, `--bento-color-blue-dark`,
`--bento-control-height-md`, `--bento-control-padding-x`, `--bento-radius-md`,
`--bento-text-base`, `--bento-font-weight-medium`.

---

## Input

**When to use.** Any single-line text entry — name, email, URL, search
field. Always pair with a `.bento-input__label`. Use `.bento-input--error`
(or `aria-invalid="true"`) plus a `.bento-input__error` message when
validation fails. Default size is 44px tall.

**Canonical HTML.**

```html
<div>
  <label class="bento-input__label" for="email">Email</label>
  <input type="email" id="email" class="bento-input" placeholder="you@example.com">
</div>
```

**Variants.**

```html
<!-- With help text -->
<div>
  <label class="bento-input__label" for="url">Website</label>
  <input type="url" id="url" class="bento-input" placeholder="https://example.com">
  <span class="bento-input__help">Include the protocol (https://).</span>
</div>

<!-- Error state -->
<div>
  <label class="bento-input__label" for="name">Name</label>
  <input type="text" id="name" class="bento-input bento-input--error" aria-invalid="true" value="">
  <span class="bento-input__error">Name is required.</span>
</div>

<!-- Disabled -->
<div>
  <label class="bento-input__label" for="uid">User ID</label>
  <input type="text" id="uid" class="bento-input" value="u_abc123" disabled>
</div>
```

**Tokens it leans on.** `--bento-control-height-md`, `--bento-color-grey-30`,
`--bento-color-grey-50`, `--bento-color-blue-100`, `--bento-color-blue-20`,
`--bento-radius-md`, `--bento-text-sm`.

---

## Textarea

**When to use.** Multi-line free-text entry — descriptions, comments,
messages. Use the same label/help/error pattern as `.bento-input`.

**Canonical HTML.**

```html
<div>
  <label class="bento-input__label" for="desc">Description</label>
  <textarea id="desc" class="bento-textarea" rows="3" placeholder="Add a description…"></textarea>
</div>
```

**Variants.**

```html
<!-- Error state -->
<div>
  <label class="bento-input__label" for="note">Note</label>
  <textarea id="note" class="bento-textarea bento-textarea--error" aria-invalid="true" rows="3"></textarea>
  <span class="bento-input__error">Note is required.</span>
</div>

<!-- Disabled -->
<textarea class="bento-textarea" rows="3" disabled>Frozen content</textarea>
```

**Tokens it leans on.** Same as `.bento-input` plus `--bento-space-2`,
`--bento-space-3` for padding.

---

## Select

**When to use.** Choose one value from a short, fixed list of options.
For long lists, free-typing, or multi-select, the richer Bento dropdown
pattern is preferred — but the native `<select>` styled with
`.bento-select` is the canonical v1 markup since it's self-contained
and needs no JavaScript.

**Canonical HTML.**

```html
<div>
  <label class="bento-input__label" for="country">Country</label>
  <select id="country" class="bento-select">
    <option value="">Select a country…</option>
    <option value="us">United States</option>
    <option value="ca">Canada</option>
    <option value="mx">Mexico</option>
  </select>
</div>
```

**Variants.**

```html
<!-- Disabled -->
<select class="bento-select" disabled>
  <option>Locked</option>
</select>
```

**Tokens it leans on.** `--bento-control-height-md`, `--bento-color-grey-30`,
`--bento-color-grey-50`, `--bento-radius-md`, `--bento-text-sm`,
`--bento-space-3`, `--bento-space-4`.

---

## Checkbox

**When to use.** A single toggleable option or a list of independently
toggleable options. Group multiple checkboxes in a `<fieldset>` with a
`<legend>` when they share a question.

**Canonical HTML.**

```html
<label class="bento-checkbox">
  <input type="checkbox" class="bento-checkbox__input" checked>
  <span class="bento-checkbox__label">Email me about new releases</span>
</label>
```

**Variants.**

```html
<!-- Unchecked -->
<label class="bento-checkbox">
  <input type="checkbox" class="bento-checkbox__input">
  <span class="bento-checkbox__label">I accept the terms</span>
</label>

<!-- Disabled -->
<label class="bento-checkbox">
  <input type="checkbox" class="bento-checkbox__input" disabled>
  <span class="bento-checkbox__label">Locked option</span>
</label>

<!-- Group -->
<fieldset>
  <legend class="bento-input__label">Notifications</legend>
  <label class="bento-checkbox">
    <input type="checkbox" class="bento-checkbox__input" checked>
    <span class="bento-checkbox__label">Weekly digest</span>
  </label>
  <label class="bento-checkbox">
    <input type="checkbox" class="bento-checkbox__input">
    <span class="bento-checkbox__label">Security alerts</span>
  </label>
</fieldset>
```

**Tokens it leans on.** `--bento-color-blue-100`, `--bento-color-grey-30`,
`--bento-radius-sm`, `--bento-text-sm`.

---

## Radio

**When to use.** Choose exactly one option from a mutually exclusive
group. All radios in a group share a `name` attribute.

**Canonical HTML.**

```html
<fieldset>
  <legend class="bento-input__label">Plan</legend>
  <label class="bento-radio">
    <input type="radio" name="plan" class="bento-radio__input" value="free" checked>
    <span class="bento-radio__label">Free</span>
  </label>
  <label class="bento-radio">
    <input type="radio" name="plan" class="bento-radio__input" value="pro">
    <span class="bento-radio__label">Pro</span>
  </label>
  <label class="bento-radio">
    <input type="radio" name="plan" class="bento-radio__input" value="team">
    <span class="bento-radio__label">Team</span>
  </label>
</fieldset>
```

**Variants.**

```html
<!-- Disabled -->
<label class="bento-radio">
  <input type="radio" name="plan" class="bento-radio__input" value="enterprise" disabled>
  <span class="bento-radio__label">Enterprise (contact sales)</span>
</label>
```

**Tokens it leans on.** `--bento-color-blue-100`, `--bento-color-grey-30`,
`--bento-radius-full`, `--bento-text-sm`.

---

## Card

**When to use.** Group related content on a surface — a summary, a
profile, a stats tile, a settings section. Always use at least a
`__body`. Add `__header` and `__footer` when you have a title or
trailing actions.

**Canonical HTML.**

```html
<div class="bento-card">
  <div class="bento-card__header">Team members</div>
  <div class="bento-card__body">
    <p>Invite teammates to collaborate on snapshots.</p>
  </div>
  <div class="bento-card__footer">
    <button type="button" class="bento-button bento-button--secondary">Manage</button>
    <button type="button" class="bento-button bento-button--primary">Invite</button>
  </div>
</div>
```

**Variants.**

```html
<!-- Body only -->
<div class="bento-card">
  <div class="bento-card__body">Standalone body content.</div>
</div>

<!-- Raised (shadow) -->
<div class="bento-card bento-card--raised">
  <div class="bento-card__body">Pops off the page.</div>
</div>

<!-- Interactive (clickable) -->
<a href="/details" class="bento-card bento-card--interactive">
  <div class="bento-card__body">Click me</div>
</a>
```

**Tokens it leans on.** `--bento-color-grey-0`, `--bento-color-grey-10`,
`--bento-color-grey-20`, `--bento-radius-lg`, `--bento-space-4`,
`--bento-space-6`, `--bento-text-h3`.

---

## Badge

**When to use.** Inline status or categorization label, typically short
(1–3 words). Use next to an item's primary text. For longer messages,
use `.bento-alert` instead.

**Canonical HTML.**

```html
<span class="bento-badge bento-badge--info">New</span>
```

**Variants.**

```html
<span class="bento-badge bento-badge--neutral">Draft</span>
<span class="bento-badge bento-badge--primary">Featured</span>
<span class="bento-badge bento-badge--success">Active</span>
<span class="bento-badge bento-badge--warning">Pending</span>
<span class="bento-badge bento-badge--danger">Failed</span>
<span class="bento-badge bento-badge--info">Beta</span>
```

**Tokens it leans on.** `--bento-radius-pill`, `--bento-text-sm`,
`--bento-font-weight-medium`, status colors (`--bento-color-success-*`,
`--bento-color-warning-*`, `--bento-color-danger-*`,
`--bento-color-blue-*`, `--bento-color-grey-*`).

---

## Dialog

**When to use.** Modal dialogs that require a decision or focused input
before the user returns to the underlying page. Keep them short; use a
dedicated page for anything longer than one screen.

**Canonical HTML.**

```html
<div class="bento-dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-subtitle">
  <div class="bento-dialog__backdrop"></div>
  <div class="bento-dialog__panel">
    <button type="button" class="bento-dialog__close" aria-label="Close">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
    <div class="bento-dialog__header">
      <h4 class="bento-dialog__title">Confirm</h4>
    </div>
    <h2 id="dlg-subtitle" class="bento-dialog__subtitle">Delete snapshot?</h2>
    <div class="bento-dialog__body">
      <p>This can't be undone. All remix versions will be removed as well.</p>
    </div>
    <div class="bento-dialog__footer">
      <button type="button" class="bento-button bento-button--secondary">Cancel</button>
      <button type="button" class="bento-button bento-button--danger">Delete</button>
    </div>
  </div>
</div>
```

**Variants.**

```html
<!-- Small dialog -->
<div class="bento-dialog bento-dialog--sm" role="dialog" aria-modal="true">
  <div class="bento-dialog__backdrop"></div>
  <div class="bento-dialog__panel">
    <div class="bento-dialog__header">
      <h4 class="bento-dialog__title">Quick confirm</h4>
    </div>
    <h2 class="bento-dialog__subtitle">Are you sure?</h2>
    <div class="bento-dialog__footer">
      <button class="bento-button bento-button--secondary">No</button>
      <button class="bento-button bento-button--primary">Yes</button>
    </div>
  </div>
</div>
```

**Tokens it leans on.** `--bento-color-grey-30` (backdrop),
`--bento-radius-lg`, `--bento-shadow-lg`, `--bento-text-3xl` (subtitle),
`--bento-text-base` (title, uppercase), `--bento-z-dialog`.

---

## Table

**When to use.** Structured tabular data — rows + columns where the
same attributes apply to each row. For two-column key/value readouts,
a plain `<dl>` is often better.

**Canonical HTML.**

```html
<table class="bento-table">
  <thead class="bento-table__header">
    <tr>
      <th class="bento-table__header-cell">Name</th>
      <th class="bento-table__header-cell">Status</th>
      <th class="bento-table__header-cell bento-table__cell--numeric">Count</th>
    </tr>
  </thead>
  <tbody>
    <tr class="bento-table__row">
      <td class="bento-table__cell">Dashboard</td>
      <td class="bento-table__cell">
        <span class="bento-badge bento-badge--success">Active</span>
      </td>
      <td class="bento-table__cell bento-table__cell--numeric">128</td>
    </tr>
    <tr class="bento-table__row">
      <td class="bento-table__cell">Report</td>
      <td class="bento-table__cell">
        <span class="bento-badge bento-badge--warning">Pending</span>
      </td>
      <td class="bento-table__cell bento-table__cell--numeric">42</td>
    </tr>
    <tr class="bento-table__row">
      <td class="bento-table__cell">Archive</td>
      <td class="bento-table__cell bento-table__cell--muted">—</td>
      <td class="bento-table__cell bento-table__cell--numeric">0</td>
    </tr>
  </tbody>
</table>
```

**Tokens it leans on.** `--bento-color-grey-2` (header row),
`--bento-color-grey-10` (row separator), `--bento-color-grey-20` (outer
border), `--bento-text-sm`, `--bento-font-weight-semibold`.

---

## Tabs

**When to use.** Switch between peer views of the same page — e.g.
"Overview | Details | History". Keep labels short. Don't use for linear
wizards — use distinct pages or a progress indicator instead.

**Canonical HTML.**

```html
<div class="bento-tabs">
  <div class="bento-tabs__list" role="tablist">
    <button type="button" class="bento-tabs__tab bento-tabs__tab--active" role="tab" aria-selected="true" aria-controls="tab-overview">Overview</button>
    <button type="button" class="bento-tabs__tab" role="tab" aria-selected="false" aria-controls="tab-details">Details</button>
    <button type="button" class="bento-tabs__tab" role="tab" aria-selected="false" aria-controls="tab-history">History</button>
  </div>
  <div id="tab-overview" class="bento-tabs__panel" role="tabpanel">
    <p>Overview content goes here.</p>
  </div>
  <div id="tab-details" class="bento-tabs__panel" role="tabpanel" hidden>
    <p>Details content.</p>
  </div>
  <div id="tab-history" class="bento-tabs__panel" role="tabpanel" hidden>
    <p>History content.</p>
  </div>
</div>
```

**Variants.**

```html
<!-- Disabled tab -->
<button type="button" class="bento-tabs__tab" disabled>Soon</button>
```

**Tokens it leans on.** `--bento-color-blue-100`, `--bento-color-grey-70`,
`--bento-color-grey-20` (list underline), `--bento-border-width-md`,
`--bento-text-sm`, `--bento-font-weight-medium`.

---

## Avatar

**When to use.** Represent a user, organization, or entity with an
image or initials. Use alongside a name or in a list. Default is 32px
(`--md`); use `--sm` (24px) in dense lists, `--lg` (48px) in detail
views, `--xl` (64px) in profile headers.

**Canonical HTML.**

```html
<!-- Image avatar -->
<span class="bento-avatar bento-avatar--md" aria-label="Josh Brinksman">
  <img class="bento-avatar__image" src="https://example.com/josh.jpg" alt="">
</span>
```

**Variants.**

```html
<!-- Initials fallback -->
<span class="bento-avatar bento-avatar--md" aria-label="Josh Brinksman">JB</span>

<!-- Small / Large / XL -->
<span class="bento-avatar bento-avatar--sm">JB</span>
<span class="bento-avatar bento-avatar--lg">JB</span>
<span class="bento-avatar bento-avatar--xl">JB</span>
```

**Tokens it leans on.** `--bento-radius-full`, `--bento-color-blue-100`,
`--bento-color-grey-0`, `--bento-text-xs` / `--bento-text-sm` /
`--bento-text-base` / `--bento-text-lg`.

---

## Alert

**When to use.** Inline page-level notification — confirmation of an
action, status of a system, or a heads-up about something changing.
For transient toasts, use a separate toast pattern (out of v1 scope).
For short single-token labels, prefer `.bento-badge`.

**Canonical HTML.**

```html
<div class="bento-alert bento-alert--info" role="status">
  <span class="bento-alert__icon" aria-hidden="true">
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
  </span>
  <div class="bento-alert__body">
    <h4 class="bento-alert__title">Heads up</h4>
    <p>Your snapshot will be available for 30 days.</p>
  </div>
</div>
```

**Variants.**

```html
<!-- Success -->
<div class="bento-alert bento-alert--success" role="status">
  <div class="bento-alert__body">
    <h4 class="bento-alert__title">Saved</h4>
    <p>Your changes were committed.</p>
  </div>
</div>

<!-- Warning -->
<div class="bento-alert bento-alert--warning" role="status">
  <div class="bento-alert__body">
    <h4 class="bento-alert__title">Check your settings</h4>
    <p>Provider credentials are missing.</p>
  </div>
</div>

<!-- Danger -->
<div class="bento-alert bento-alert--danger" role="alert">
  <div class="bento-alert__body">
    <h4 class="bento-alert__title">Upload failed</h4>
    <p>Please retry or contact support.</p>
  </div>
</div>
```

**Tokens it leans on.** Status colors (`--bento-color-success-*`,
`--bento-color-warning-*`, `--bento-color-danger-*`,
`--bento-color-blue-*`), `--bento-radius-md`, `--bento-text-sm`,
`--bento-font-weight-semibold`.
