// Branded select / combobox. Radix Popover handles positioning, collision and dismissal;
// cmdk handles keyboard navigation, type-to-search and listbox semantics.
import { Children, Fragment, isValidElement, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { floatingPanel, stopPortalBubble, usePortalContainer } from './layer';
import { useFieldLabelledBy } from './field';

export interface SelectOption {
  value: string;
  label: string;
  group?: string;
  disabled?: boolean;
}

const triggerBase =
  'flex w-full items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-left text-sm text-ink transition dark:bg-canvas/50 ' +
  'hover:border-navy-200 focus:outline-none focus-visible:border-brand focus-visible:ring-4 focus-visible:ring-brand/15 ' +
  'data-[state=open]:border-brand data-[state=open]:ring-4 data-[state=open]:ring-brand/15 disabled:cursor-not-allowed disabled:opacity-60';

interface BaseProps {
  options: SelectOption[];
  placeholder?: string;
  /** Show a search box (defaults to on for long lists). */
  searchable?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  triggerClassName?: string;
  size?: 'md' | 'sm';
  'aria-label'?: string;
  id?: string;
  /** Content shown as the trigger label instead of the selected option label. */
  renderValue?: (selected: SelectOption[]) => ReactNode;
}

type SingleProps = BaseProps & { multiple?: false; value: string; onChange: (v: string) => void; clearable?: boolean };
type MultiProps = BaseProps & { multiple: true; value: string[]; onChange: (v: string[]) => void; clearable?: boolean };

export function SelectMenu(props: SingleProps | MultiProps) {
  const labelledBy = useFieldLabelledBy();
  const { options, placeholder = 'Select…', disabled, invalid, className, triggerClassName, size = 'md', renderValue, id } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const container = usePortalContainer();
  const searchable = props.searchable ?? options.length > 8;
  const selectedValues = props.multiple ? props.value : props.value ? [props.value] : [];
  const selected = options.filter((o) => selectedValues.includes(o.value));

  const groups = useMemo(() => {
    const m = new Map<string, SelectOption[]>();
    options.forEach((o) => m.set(o.group ?? '', [...(m.get(o.group ?? '') ?? []), o]));
    return [...m.entries()];
  }, [options]);

  const pick = (v: string) => {
    if (props.multiple) {
      props.onChange(props.value.includes(v) ? props.value.filter((x) => x !== v) : [...props.value, v]);
    } else {
      props.onChange(v);
      setOpen(false);
    }
  };
  const clear = () => (props.multiple ? props.onChange([]) : props.onChange(''));

  const label =
    renderValue?.(selected) ??
    (selected.length === 0 ? (
      <span className="truncate text-ink-mute">{placeholder}</span>
    ) : props.multiple ? (
      <span className="truncate">{selected.length === 1 ? selected[0].label : `${selected.length} selected`}</span>
    ) : (
      <span className="truncate">{selected[0].label}</span>
    ));

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery('');
      }}
    >
      <div className={cn('relative', className)}>
        <Popover.Trigger asChild disabled={disabled}>
          <button
            type="button"
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-label={props['aria-label']}
            aria-labelledby={props['aria-label'] ? undefined : labelledBy}
            aria-invalid={invalid || undefined}
            className={cn(triggerBase, size === 'sm' ? 'h-10' : 'h-11', props.clearable && selected.length ? 'pr-16' : 'pr-9', invalid && 'border-red-400', triggerClassName)}
          >
            {label}
          </button>
        </Popover.Trigger>
        {props.clearable && selected.length > 0 && !disabled && (
          <button
            type="button"
            aria-label="Clear selection"
            onClick={clear}
            className="absolute right-8 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-mute hover:bg-canvas hover:text-heading"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <ChevronDown className={cn('pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute transition', open && 'rotate-180')} />
      </div>
      <Popover.Portal container={container}>
        <Popover.Content onClick={stopPortalBubble}
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(e) => {
            // Focus the search box (or the list) instead of the first element Radix picks.
            e.preventDefault();
            const el = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[cmdk-input], [cmdk-list]');
            el?.focus();
          }}
          className={cn(floatingPanel, 'w-[var(--radix-popover-trigger-width)] min-w-[13rem] p-0')}
        >
          <Command
            loop
            defaultValue={selected[0] ? `${selected[0].label}␟${selected[0].value}` : undefined}
            filter={(value, search) => (value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}
          >
            {searchable && (
              <div className="flex items-center gap-2 border-b border-line px-3">
                <Search className="h-4 w-4 shrink-0 text-ink-mute" />
                <Command.Input
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Search…"
                  className="h-10 w-full bg-transparent text-sm text-ink placeholder:text-ink-mute focus:outline-none"
                />
              </div>
            )}
            <Command.List tabIndex={searchable ? undefined : 0} className="max-h-[min(18rem,var(--radix-popover-content-available-height))] overflow-y-auto overscroll-contain p-1.5 focus:outline-none">
              <Command.Empty className="px-3 py-6 text-center text-sm text-ink-mute">No matches</Command.Empty>
              {groups.map(([group, opts]) => (
                <Command.Group
                  key={group || 'default'}
                  heading={group || undefined}
                  className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-ink-mute"
                >
                  {opts.map((o) => {
                    const isSel = selectedValues.includes(o.value);
                    return (
                      <Command.Item
                        key={o.value || '__empty'}
                        value={`${o.label}␟${o.value}`}
                        disabled={o.disabled}
                        onSelect={() => pick(o.value)}
                        className={cn(
                          'flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-soft transition-colors',
                          'data-[selected=true]:bg-canvas data-[selected=true]:text-heading data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-40',
                          isSel && 'font-semibold text-heading',
                        )}
                      >
                        {props.multiple && (
                          <span
                            aria-hidden
                            className={cn(
                              'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition',
                              isSel ? 'border-rust bg-rust text-white' : 'border-line bg-surface',
                            )}
                          >
                            {isSel && <Check className="h-3 w-3" strokeWidth={3} />}
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate">{o.label}</span>
                        {!props.multiple && isSel && <Check className="h-4 w-4 shrink-0 text-rust" />}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ))}
            </Command.List>
            {props.multiple && (
              <div className="flex items-center justify-between border-t border-line px-3 py-2 text-xs">
                <span className="text-ink-mute">{selected.length} selected</span>
                <button type="button" onClick={clear} className="font-semibold text-rust hover:underline">
                  Clear
                </button>
              </div>
            )}
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ---------------------------------------------------------- drop-in Select */

type OptionEl = ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean; label?: string }>;
const text = (n: ReactNode): string =>
  typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(text).join('') : isValidElement(n) ? text((n.props as { children?: ReactNode }).children) : '';

/** Reads `<option>` / `<optgroup>` children so existing markup keeps working. */
function optionsFromChildren(children: ReactNode): SelectOption[] {
  const out: SelectOption[] = [];
  const visit = (nodes: ReactNode, group?: string) =>
    Children.forEach(nodes, (child) => {
      if (!isValidElement(child)) return;
      const el = child as OptionEl;
      if (el.type === 'optgroup') return visit(el.props.children, el.props.label);
      if (el.type === 'option') {
        const label = text(el.props.children);
        out.push({ value: el.props.value !== undefined ? String(el.props.value) : label, label, group, disabled: el.props.disabled });
      } else if (el.type === Fragment) {
        visit(el.props.children, group);
      }
    });
  visit(children);
  return out;
}

export interface SelectProps {
  value: string | number;
  onChange: (e: { target: { value: string } }) => void;
  children: ReactNode;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  searchable?: boolean;
  'aria-label'?: string;
  id?: string;
}

/**
 * Drop-in replacement for a native <select>: same `value`, `onChange(e)` and
 * `<option>` children, rendered with the branded SelectMenu.
 */
export function Select({ value, onChange, children, disabled, invalid, className, searchable, id, ...rest }: SelectProps) {
  const all = optionsFromChildren(children);
  // An option with an empty value acts as the placeholder.
  const placeholderOpt = all.find((o) => o.value === '');
  const options = all.filter((o) => o.value !== '');
  return (
    <SelectMenu
      id={id}
      value={String(value ?? '')}
      onChange={(v) => onChange({ target: { value: v } })}
      options={options}
      placeholder={placeholderOpt?.label ?? 'Select…'}
      clearable={!!placeholderOpt}
      disabled={disabled}
      invalid={invalid}
      searchable={searchable}
      triggerClassName={className}
      aria-label={rest['aria-label']}
    />
  );
}

/** Compact filter dropdown: the empty value shows `label` and means "all". */
export function FilterSelect({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: (string | { value: string; label: string })[]; label: string }) {
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  return (
    <SelectMenu
      size="sm"
      aria-label={label}
      value={value}
      onChange={onChange}
      clearable
      options={opts}
      placeholder={label}
      className="min-w-[9.5rem]"
      triggerClassName={cn('font-medium', value && 'border-brand-300 bg-brand-50/50 text-rust dark:bg-brand-50/50')}
      renderValue={(sel) => <span className={cn('truncate', !sel.length && 'text-ink-soft')}>{sel[0]?.label ?? label}</span>}
    />
  );
}
