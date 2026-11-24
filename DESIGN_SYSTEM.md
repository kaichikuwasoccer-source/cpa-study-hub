# CPA Study Hub — Design System & Figma Integration Rules

This document defines the design system structure, tokens, component architecture, and styling conventions for the unified **CPA Study Hub** application (combining the Dashboard Hub and Study Logger views). Use these rules when translating designs between Figma and code via the Figma MCP server.

---

## 1. Token Definitions

Design tokens are defined inline in `index.html` via Tailwind CSS configuration (`tailwind.config`), Tailwind utility palettes (`slate`, `blue`, `emerald`, `rose`, `amber`, `violet`), and JavaScript constant maps (`SUBJECT_COLORS`, `COLOR_STYLES`). No separate CSS token build pipeline or token transformer (e.g. Style Dictionary) is used.

### Color Tokens

| Semantic Role | Light Mode | Dark Mode | Tailwind Class / Hex |
|---|---|---|---|
| **App Background** | `#F8FAFC` | `#020617` | `bg-slate-50` / `dark:bg-slate-950` |
| **Surface / Card** | `#FFFFFF` | `#0F172A` | `bg-white` / `dark:bg-slate-900` |
| **Subtle Surface** | `#F8FAFC` (70%) | `#1E293B` (50%) | `bg-slate-50/70` / `dark:bg-slate-800/50` |
| **Border Default** | `#E2E8F0` | `#1E293B` | `border-slate-200` / `dark:border-slate-800` |
| **Text Primary** | `#1E293B` | `#F1F5F9` | `text-slate-800` / `dark:text-slate-100` |
| **Text Secondary** | `#64748B` | `#94A3B8` | `text-slate-500` / `dark:text-slate-400` |
| **Brand Primary** | `#2563EB` | `#2563EB` | `bg-blue-600` (hover: `#1D4ED8` / `bg-blue-700`) |
| **Status Success / Positive** | `#10B981` | `#34D399` | `emerald-500` / `dark:text-emerald-400` |
| **Status Danger / Behind** | `#E11D48` | `#FB7185` | `rose-600` / `dark:text-rose-400` |
| **Status Warning** | `#D97706` | `#FBBF24` | `amber-600` / `dark:text-amber-400` |

### Subject Chart Palette (`SUBJECT_COLORS` in `index.html`)

```js
const SUBJECTS = ['財務(計算)', '財務(理論)', '管理会計', '監査論', '企業法', '租税法', '選択科目'];
const SUBJECT_COLORS = ['#2563eb', '#38bdf8', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#64748b'];
```

### Typography & Spacing Tokens

- **Font Family**: `Inter`, `"Noto Sans JP"`, `sans-serif` (loaded via Google Fonts CDN).
- **Type Scale**:
  - Brand Title: `18px` / `font-extrabold` (`text-lg tracking-tight`)
  - Section Label: `14px` / `font-bold uppercase tracking-wider` (`text-sm`)
  - KPI Hero Metric: `30px` / `font-extrabold` (`text-3xl tracking-tight`)
  - Timer Display: `40px` / `font-extrabold tabular-nums` (`text-4xl`)
  - Card Title: `14px` / `font-bold` (`text-sm`)
  - Body / Metadata: `12px` (`text-xs`)
- **Radii**: Cards `16px` (`rounded-2xl`), Controls/Buttons `12px` (`rounded-xl`), Compact Buttons/Badges `8px` (`rounded-lg`) or pill (`rounded-full`).
- **Spacing**: Main container `max-w-6xl` (`1152px`), section gap `24px` (`space-y-6`), card grid gap `16px` (`gap-4`), card internal padding `20px` (`p-5`).

---

## 2. Component Library

This project is a zero-build single-file web application. UI components are authored as semantic HTML sections and dynamically rendered DOM templates inside `cpa-study-hub-main/cpa-study-hub-main/index.html`. There is no Storybook or external component package.

### Core UI Patterns

1. **Sticky App Header & Navigation Switcher**
   - Desktop (`sm:`+): Segmented pill switcher in the header (`ハブ` / `記録`) with live timer indicator badge.
   - Mobile (`< sm`): Fixed bottom tab bar (`fixed bottom-0 inset-x-0 z-40`) with thumb-friendly touch targets.
2. **Card Container**
   - Standard pattern: `rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900`.
3. **Countdown Card (`renderCountdowns`)**
   - Left 4px accent border (`border-l-4`) color-coded by category (`rose`, `blue`, `emerald`, `amber`), date + event title on left, remaining days + compact edit/delete icon buttons on right.
4. **Single-Gauge KPI Card & Insight + AI Action Card**
   - 2-column grid (`sm:grid-cols-2`). Left card holds the active period total, progress bar, and subtle sub-period summary. Right card holds top subject focus, behind-schedule insight, and one-click `ChatGPTに送る` / `Geminiに送る` action buttons.
5. **Interactive Chip Selector (Logger View)**
   - Pill buttons (`rounded-full`) for Subjects, Materials (with editable delete mode), and Confidence Ratings (`◎ 余裕`, `○ 普通`, `△ 要復習`).
6. **Modal Dialogs**
   - Backdrop blur overlay (`bg-slate-900/50 backdrop-blur-sm`) housing a centered `rounded-2xl` form card (`#settingsModal`, `#countdownModal`).

---

## 3. Frameworks & Libraries

- **UI Framework**: Vanilla HTML5 + ES2020 JavaScript (zero framework overhead).
- **Styling Library**: Tailwind CSS v3 via Play CDN (`https://cdn.tailwindcss.com`) with class-based dark mode (`darkMode: 'class'`).
- **Data Visualization**: Chart.js via jsDelivr CDN (`https://cdn.jsdelivr.net/npm/chart.js`) for Bar (`予定 vs 実績`) and Doughnut (`科目別割合`) charts.
- **Build System / Hosting**: Static file deployment on Vercel directly from GitHub (`kaichikuwasoccer-source/cpa-study-hub`), no bundler required.

---

## 4. Asset Management

- **App Icons**: Stored as root-level 512×512 PNG files (`icon2.png` in `cpa-study-hub-main/cpa-study-hub-main/`).
- **Cache Busting**: Referenced with query strings in `<head>`:
  ```html
  <link rel="apple-touch-icon" href="icon2.png?v=2" />
  <link rel="icon" type="image/png" href="icon2.png?v=2" />
  ```
- **CDN Assets**: Fonts (`fonts.googleapis.com`), Tailwind (`cdn.tailwindcss.com`), and Chart.js (`cdn.jsdelivr.net`) are loaded from public CDNs.

---

## 5. Icon System

- **UI Icons**: Inline Heroicons-style outline SVGs (`stroke="currentColor"`, `stroke-width="2"`, `viewBox="0 0 24 24"`) embedded directly in HTML buttons and navigation tabs (`h-4 w-4` or `h-5 w-5`).
- **Quick Link / Category Accents**: Compact rounded icon badges (`h-10 w-10 rounded-xl`) paired with soft tinted backgrounds (`bg-blue-50`, `bg-emerald-50`, `bg-amber-50`, `bg-violet-50`).
- **Naming Convention**: Icons are not imported from files; functional buttons use descriptive `id` attributes (e.g., `refreshIcon`, `themeToggleBtn`, `openSettingsBtn`).

---

## 6. Styling Approach

- **Methodology**: Utility-first CSS using Tailwind CSS classes directly on elements.
- **Dark Mode**: Controlled by toggling the `.dark` class on `<html>`, persisted in `localStorage` (`cpa_hub_theme_v1`), falling back to `prefers-color-scheme: dark`.
- **Responsive Breakpoints**:
  - Mobile-first single-column layout (`grid-cols-1`) with bottom navigation bar (`sm:hidden`) and bottom safe padding (`pb-24 sm:pb-8`).
  - `sm` (`640px+`): Top segmented switcher visible, 2-column KPI/Countdown grids.
  - `lg` (`1024px+`): 3-column countdown/chart grids (`lg:grid-cols-3`) and 2-column gap/quick-link split (`lg:grid-cols-2`).

---

## 7. Project Structure

```text
cpa-apps/
├── cpa-study-hub-main/
│   └── cpa-study-hub-main/          # Unified App (Hub + Logger) -> GitHub: cpa-study-hub
│       ├── index.html               # Full SPA (Header, Bottom Nav, Hub View, Logger View, Modals, GAS Sync)
│       ├── icon2.png                # 512x512 App Icon (Royal Blue 3-bar glass emblem)
│       └── DESIGN_SYSTEM.md         # This Figma & Design System rules document
└── cpa-app-main/
    └── cpa-app-main/                # Legacy standalone Logger -> GitHub: cpa-app
        ├── index.html
        └── icon.png                 # 512x512 App Icon (Indigo timer ring emblem)
```

### Key Architectural Pattern
- **Backend Sync**: Google Apps Script (GAS) Web App endpoint (`GAS_URL`) serving as a lightweight JSON API for study logs, calendar planned hours, synced materials (`saveMaterials`), active cross-device timer (`saveTimer`), and Hub config/countdowns (`saveHubConfig`).
- **State Persistence**: Optimistic `localStorage` caching paired with asynchronous GAS synchronization so the UI loads instantaneously on both desktop and mobile.
