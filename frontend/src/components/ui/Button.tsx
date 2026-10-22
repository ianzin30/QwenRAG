import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons/Icon';

type Variant = 'primary' | 'secondary' | 'danger' | 'danger-ghost' | 'link';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: IconName;
  size?: 'md' | 'sm' | 'lg';
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', icon, size = 'md', className, children, type = 'button', ...rest },
  ref,
) {
  const classes = ['btn', `btn--${variant}`, size !== 'md' && `btn--${size}`, className].filter(Boolean).join(' ');
  return (
    <button ref={ref} type={type} className={classes} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children}
    </button>
  );
});

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  label: string; // required: icon-only buttons need an accessible name
  size?: 'md' | 'sm' | 'touch';
  iconSize?: number;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = 'md', iconSize, className, type = 'button', ...rest },
  ref,
) {
  const classes = ['icon-btn', size !== 'md' && `icon-btn--${size}`, className].filter(Boolean).join(' ');
  return (
    <button ref={ref} type={type} className={classes} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={iconSize ?? (size === 'sm' ? 15 : size === 'touch' ? 20 : 18)} />
    </button>
  );
});
