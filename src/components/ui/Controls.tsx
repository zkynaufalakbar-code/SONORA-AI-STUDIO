import React from 'react';
import { cn } from '@/lib/utils';

interface DawButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ai' | 'danger' | 'ghost';
  size?: 'xs' | 'sm' | 'md';
  active?: boolean;
}

export const DawButton: React.FC<DawButtonProps> = ({
  variant = 'default',
  size = 'sm',
  active = false,
  className,
  type = 'button',
  children,
  ...props
}) => {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded border font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed select-none';
  const sizes = {
    xs: 'h-6 px-2 text-[11px]',
    sm: 'h-7 px-2.5 text-xs',
    md: 'h-8 px-3 text-xs',
  };
  const variants = {
    default: active
      ? 'bg-[#202737] border-[#3B82F6] text-white'
      : 'bg-[#181C25] border-[#282E3D] text-[#D1D5DB] hover:bg-[#202531] hover:border-[#363E52]',
    primary:
      'bg-[#3B82F6] border-[#3B82F6] text-white hover:bg-[#2563EB]',
    ai: 'bg-[#8B5CF6]/20 border-[#8B5CF6]/60 text-[#DDD6FE] hover:bg-[#8B5CF6]/30',
    danger:
      'bg-[#EF4444]/15 border-[#EF4444]/50 text-[#FCA5A5] hover:bg-[#EF4444]/25',
    ghost: active
      ? 'bg-[#202531] border-transparent text-white'
      : 'bg-transparent border-transparent text-[#9CA6B8] hover:bg-[#181C25] hover:text-white',
  };

  return (
    <button
      type={type}
      className={cn(base, sizes[size], variants[variant], className)}
      {...props}
    >
      {children}
    </button>
  );
};

interface ParamSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  defaultValue?: number;
  onChange: (value: number) => void;
  formatValue?: (val: number) => string;
}

export const ParamSlider: React.FC<ParamSliderProps> = ({
  label,
  value,
  min,
  max,
  step = 0.1,
  unit = '',
  defaultValue,
  onChange,
  formatValue,
}) => {
  const id = React.useId();
  const display = formatValue
    ? formatValue(value)
    : `${step >= 1 ? value.toFixed(0) : value.toFixed(2)}${unit ? ` ${unit}` : ''}`;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px]">
        <label htmlFor={id} className="text-[#9CA6B8] truncate">
          {label}
        </label>
        <span className="font-mono-tabular text-[#E5E7EB] text-[11px]">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onDoubleClick={() => {
          if (defaultValue !== undefined) onChange(defaultValue);
        }}
        className="daw-slider w-full h-3"
      />
    </div>
  );
};

interface NativeModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  maxWidthClass?: string;
  children: React.ReactNode;
}

export const NativeModal: React.FC<NativeModalProps> = ({
  open,
  onClose,
  title,
  maxWidthClass = 'max-w-2xl',
  children,
}) => {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const pressedOutsideRef = React.useRef(false);
  const titleId = React.useId();

  React.useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  if (!open) return null;

  const isPointerOutside = (e: React.PointerEvent<HTMLDialogElement>) => {
    const dlg = dialogRef.current;
    if (!dlg) return false;
    const r = dlg.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onPointerDown={(e) => {
        pressedOutsideRef.current = isPointerOutside(e);
      }}
      onPointerUp={(e) => {
        if (pressedOutsideRef.current && isPointerOutside(e)) {
          onClose();
        }
        pressedOutsideRef.current = false;
      }}
      className={cn(
        'm-auto w-[92vw] rounded-lg border border-[#2D3446] bg-[#12151C] text-[#EEF1F6] p-0 shadow-2xl',
        maxWidthClass,
      )}
    >
      <div className="flex items-center justify-between border-b border-[#252B38] px-4 py-3 bg-[#151922]">
        <h2 id={titleId} className="text-sm font-semibold tracking-tight text-white">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close modal"
          className="rounded px-2 py-1 text-xs text-[#9CA6B8] hover:bg-[#202531] hover:text-white cursor-pointer"
        >
          Esc
        </button>
      </div>
      <div className="max-h-[80vh] overflow-y-auto p-4">{children}</div>
    </dialog>
  );
};
