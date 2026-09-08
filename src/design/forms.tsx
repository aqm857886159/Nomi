import {
  Checkbox,
  NumberInput,
  SegmentedControl,
  Switch,
  TextInput,
  Textarea,
  type CheckboxProps,
  type NumberInputProps,
  type SegmentedControlProps,
  type SwitchProps,
  type TextInputProps,
  type TextareaProps,
} from '@mantine/core'
import { cn } from '../utils/cn'

export type DesignCheckboxProps = CheckboxProps
export type DesignTextInputProps = TextInputProps
export type DesignTextareaProps = TextareaProps
export type DesignNumberInputProps = NumberInputProps
export type DesignSegmentedControlProps = SegmentedControlProps
export type DesignSwitchProps = SwitchProps

export function DesignCheckbox({ className, radius = 'sm', ...props }: DesignCheckboxProps): JSX.Element {
  return <Checkbox {...props} className={cn('text-body-sm', className)} radius={radius} />
}

export function DesignTextInput({ className, radius = 'sm', ...props }: DesignTextInputProps): JSX.Element {
  return <TextInput {...props} className={cn('text-body-sm', className)} radius={radius} />
}

export function DesignTextarea({ className, radius = 'sm', autosize = true, ...props }: DesignTextareaProps): JSX.Element {
  return <Textarea {...props} autosize={autosize} className={cn('text-body-sm', className)} radius={radius} />
}

export function DesignNumberInput({ className, radius = 'sm', ...props }: DesignNumberInputProps): JSX.Element {
  return <NumberInput {...props} className={cn('text-body-sm', className)} radius={radius} />
}

export function DesignSegmentedControl({
  className,
  radius = 'sm',
  ...props
}: DesignSegmentedControlProps): JSX.Element {
  return <SegmentedControl {...props} className={cn('text-body-sm', className)} radius={radius} />
}

export function DesignSwitch({ className, ...props }: DesignSwitchProps): JSX.Element {
  return <Switch {...props} className={cn('text-body-sm', className)} />
}
