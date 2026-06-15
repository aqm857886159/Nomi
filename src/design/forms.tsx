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
import { cn } from '../utils/cn'

export type DesignCheckboxProps = CheckboxProps
export type DesignFileInputProps = FileInputProps
export type DesignTextInputProps = TextInputProps
export type DesignTextareaProps = TextareaProps
export type DesignSelectProps = SelectProps
export type DesignNumberInputProps = NumberInputProps
export type DesignSegmentedControlProps = SegmentedControlProps
export type DesignSwitchProps = SwitchProps

export function DesignCheckbox({ className, radius = 'sm', ...props }: DesignCheckboxProps): JSX.Element {
  const rootClassName = cn(
    'tc-design-checkbox',
    'text-body-sm',
    className,
  )

  return <Checkbox {...props} className={rootClassName} radius={radius} />
}

export function DesignFileInput({ className, radius = 'sm', ...props }: DesignFileInputProps): JSX.Element {
  const rootClassName = cn(
    'tc-design-file-input',
    'text-body-sm',
    className,
  )

  return <FileInput {...props} className={rootClassName} radius={radius} />
}

export function DesignTextInput({ className, radius = 'sm', ...props }: DesignTextInputProps): JSX.Element {
  const rootClassName = cn(
    'tc-design-text-input',
    'text-body-sm',
    className,
  )

  return <TextInput {...props} className={rootClassName} radius={radius} />
}

export function DesignTextarea({ className, radius = 'sm', autosize = true, ...props }: DesignTextareaProps): JSX.Element {
  const rootClassName = cn(
    'tc-design-textarea',
    'text-body-sm',
    className,
  )

  return <Textarea {...props} autosize={autosize} className={rootClassName} radius={radius} />
}

export function DesignSelect({ className, radius = 'sm', ...props }: DesignSelectProps): JSX.Element {
  const rootClassName = cn(
    'tc-design-select',
    'text-body-sm',
    className,
  )

  return <Select {...props} className={rootClassName} radius={radius} />
}

export function DesignNumberInput({ className, radius = 'sm', ...props }: DesignNumberInputProps): JSX.Element {
  const rootClassName = cn(
    'tc-design-number-input',
    'text-body-sm',
    className,
  )

  return <NumberInput {...props} className={rootClassName} radius={radius} />
}

export function DesignSegmentedControl({
  className,
  radius = 'sm',
  ...props
}: DesignSegmentedControlProps): JSX.Element {
  const rootClassName = cn(
    'tc-design-segmented-control',
    'text-body-sm',
    className,
  )

  return <SegmentedControl {...props} className={rootClassName} radius={radius} />
}

export function DesignSwitch({ className, ...props }: DesignSwitchProps): JSX.Element {
  const rootClassName = cn(
    'tc-design-switch',
    'text-body-sm',
    className,
  )

  return <Switch {...props} className={rootClassName} />
}
