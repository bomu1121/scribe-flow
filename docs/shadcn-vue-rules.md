# shadcn-vue 官方使用规则（已落地）

> 来源：https://github.com/unovue/shadcn-vue/blob/main/skills/shadcn-vue/rules/forms.md
> 这是 shadcn-vue 官方给 AI/开发者的**表单与输入控件选择规则**，ScribeFlow 按此执行。

## 控件选择规则

- 简单文本输入 → `Input`
- 预定义选项下拉 → `Select`
- **可搜索下拉 → `Combobox`**
- 原生 HTML select（无 JS）→ `NativeSelect`
- 布尔开关 → `Switch`（设置）或 `Checkbox`（表单）
- 少数选项单选 → `RadioGroup`
- **2–7 个选项切换 → `ToggleGroup` + `ToggleGroupItem`**
- 验证码/OTP → `InputOTP`
- 多行文本 → `Textarea`

## 表单结构规则

- 表单字段一律用 `FieldGroup` + `Field` + `FieldLabel`，不用裸 `div space-y-*`。
- 设置页用 `Field orientation="horizontal"`；隐藏标签用 `FieldLabel class="sr-only"`。
- 输入框内嵌按钮必须用 `InputGroup` + `InputGroupAddon`，不要手动 absolute 定位。
- 相关字段组用 `FieldSet` + `FieldLegend`。
- 校验/禁用状态同时给容器 `data-invalid/data-disabled`，控件给 `aria-invalid/disabled`。

## ScribeFlow 实际应用

1. **ASR 引擎**：只有 2 个选项（MiMo-V2.5 / OpenAI 兼容），按官方规则从 `Select` 改为 `ToggleGroup`（outline + sm），已落地并验证持久化。
2. **提示词块**：选项会增长且需要检索时，后续按官方规则升级为 `Combobox`；当前 3 个内置选项用官方 `Select` 符合规则。
3. 节点卡片内字段统一使用 `Input` 组件（shadcn-vue registry 原样实现）。
4. 主题令牌遵循官方 theming 规范：语义 token 通过 `@theme inline` 映射，组件层只用 `bg-background / border-input / ring-ring` 等 utility。

## 主题规则来源

- Theming：https://github.com/unovue/shadcn-vue/blob/main/apps/v4/content/docs/04.theming.md
- 组件源码：https://github.com/unovue/shadcn-vue/tree/dev/apps/v4/registry/new-york-v4/ui
