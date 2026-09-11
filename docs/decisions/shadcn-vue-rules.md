---
title: shadcn-vue 官方使用规则（历史，不再执行）
class: decision
status: deprecated
owner: 念前
last_reviewed: 2026-08-28
---

# shadcn-vue 官方使用规则（历史，不再执行）

> ⚠️ **本文件是历史记录，不再指导任何实现。** 通用 UI 已于 2026-08-28 迁移到 Element Plus，
> 当时的决策记录见 [ui-library-replacement-research.md](./ui-library-replacement-research.md)。
> 下面保留 shadcn-vue 时期的规则原文，仅用于解释更早的提交里为什么会出现 `ToggleGroup`、
> `Combobox`、`@theme inline` 这类写法。
>
> 来源：https://github.com/unovue/shadcn-vue/blob/main/skills/shadcn-vue/rules/forms.md

## 当年的控件选择规则（已被 Element Plus 取代）

- 简单文本输入 → `Input`
- 预定义选项下拉 → `Select`
- **可搜索下拉 → `Combobox`**
- 原生 HTML select（无 JS）→ `NativeSelect`
- 布尔开关 → `Switch`（设置）或 `Checkbox`（表单）
- 少数选项单选 → `RadioGroup`
- **2–7 个选项切换 → `ToggleGroup` + `ToggleGroupItem`**
- 验证码/OTP → `InputOTP`
- 多行文本 → `Textarea`

## 当年的表单结构规则

- 表单字段一律用 `FieldGroup` + `Field` + `FieldLabel`，不用裸 `div space-y-*`。
- 设置页用 `Field orientation="horizontal"`；隐藏标签用 `FieldLabel class="sr-only"`。
- 输入框内嵌按钮必须用 `InputGroup` + `InputGroupAddon`，不要手动 absolute 定位。
- 相关字段组用 `FieldSet` + `FieldLegend`。
- 校验/禁用状态同时给容器 `data-invalid/data-disabled`，控件给 `aria-invalid/disabled`。

## 旧规则到现状的对应关系

读早期提交时遇到这些组件，按右列理解当前实现：

| shadcn-vue 时期 | 现在的等价物 |
| --- | --- |
| `ToggleGroup`（2–7 个选项切换） | `el-segmented` |
| `Select`（预定义选项） | `el-select` |
| `Combobox`（可搜索） | `el-select` 的 `filterable` |
| `Switch` / `Checkbox` | `el-switch` / `el-checkbox` |
| `Textarea` | `el-input type="textarea"` |
| 节点卡片内字段用 `Input` | Element Plus 等价控件，颜色走 `styles/tokens.css` 令牌 |
| `@theme inline` 映射语义色 | `styles/element-theme.css` 把同一套令牌桥接到 `--el-*` |

## 主题规则的原始出处（存档）

- Theming：https://github.com/unovue/shadcn-vue/blob/main/apps/v4/content/docs/04.theming.md
- 组件源码：https://github.com/unovue/shadcn-vue/tree/dev/apps/v4/registry/new-york-v4/ui
