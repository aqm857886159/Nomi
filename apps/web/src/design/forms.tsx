import {
  Checkbox,
  FileInput,
  NumberInput,
  Select,
  SegmentedControl,
  Switch,
  TextInput,
  Textarea,
  type CheckboxProps,
  type FileInputProps,
  type NumberInputProps,
  type SelectProps,
  type SegmentedControlProps,
  type SwitchProps,
  type TextInputProps,
  type TextareaProps,
} from '@mantine/core'

export type DesignCheckboxProps = CheckboxProps
export type DesignFileInputProps = FileInputProps
export type DesignTextInputProps = TextInputProps
export type DesignTextareaProps = TextareaProps
export type DesignSelectProps = SelectProps
export type DesignNumberInputProps = NumberInputProps
export type DesignSegmentedControlProps = SegmentedControlProps
export type DesignSwitchProps = SwitchProps

export function DesignCheckbox({ className, radius = 'sm', ...props }: DesignCheckboxProps): JSX.Element {
  const rootClassName = className ? `tc-design-checkbox ${className}` : 'tc-design-checkbox'

  return <Checkbox {...props} className={rootClassName} radius={radius} />
}

export function DesignFileInput({ className, radius = 'sm', ...props }: DesignFileInputProps): JSX.Element {
  const rootClassName = className ? `tc-design-file-input ${className}` : 'tc-design-file-input'

  return <FileInput {...props} className={rootClassName} radius={radius} />
}

export function DesignTextInput({ className, radius = 'sm', ...props }: DesignTextInputProps): JSX.Element {
  const rootClassName = className ? `tc-design-text-input ${className}` : 'tc-design-text-input'

  return <TextInput {...props} className={rootClassName} radius={radius} />
}

export function DesignTextarea({ className, radius = 'sm', autosize = true, ...props }: DesignTextareaProps): JSX.Element {
  const rootClassName = className ? `tc-design-textarea ${className}` : 'tc-design-textarea'

  return <Textarea {...props} autosize={autosize} className={rootClassName} radius={radius} />
}

export function DesignSelect({ className, radius = 'sm', ...props }: DesignSelectProps): JSX.Element {
  const rootClassName = className ? `tc-design-select ${className}` : 'tc-design-select'

  return <Select {...props} className={rootClassName} radius={radius} />
}

export function DesignNumberInput({ className, radius = 'sm', ...props }: DesignNumberInputProps): JSX.Element {
  const rootClassName = className ? `tc-design-number-input ${className}` : 'tc-design-number-input'

  return <NumberInput {...props} className={rootClassName} radius={radius} />
}

export function DesignSegmentedControl({
  className,
  radius = 'sm',
  ...props
}: DesignSegmentedControlProps): JSX.Element {
  const rootClassName = className ? `tc-design-segmented-control ${className}` : 'tc-design-segmented-control'

  return <SegmentedControl {...props} className={rootClassName} radius={radius} />
}

export function DesignSwitch({ className, ...props }: DesignSwitchProps): JSX.Element {
  const rootClassName = className ? `tc-design-switch ${className}` : 'tc-design-switch'

  return <Switch {...props} className={rootClassName} />
}
