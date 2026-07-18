import { FC, useState, useRef, useMemo } from 'react';
import { X, Tag, Loader2 } from 'lucide-react';

export interface TagSelectorTag {
  id: string;
  name: string;
  color: string;
}

interface TagSelectorProps {
  availableTags: TagSelectorTag[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  isLoading?: boolean;
}

const TagSelector: FC<TagSelectorProps> = ({
  availableTags,
  value,
  onChange,
  placeholder = '输入标签，回车或逗号分隔...',
  disabled = false,
  isLoading = false,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedTags = useMemo(() => {
    return value
      .map((v) => {
        const found = availableTags.find((t) => t.id === v || t.name === v);
        return found || { id: v, name: v, color: '#8b949e' };
      })
      .filter((t, index, self) => self.findIndex((x) => x.name === t.name) === index);
  }, [value, availableTags]);

  const suggestions = useMemo(() => {
    if (!inputValue.trim()) return [];
    const q = inputValue.toLowerCase();
    const existingNames = new Set(selectedTags.map((t) => t.name.toLowerCase()));
    return availableTags.filter(
      (t) =>
        !existingNames.has(t.name.toLowerCase()) &&
        (t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q))
    );
  }, [inputValue, availableTags, selectedTags]);

  const addTag = (raw: string) => {
    const names = raw
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length === 0) return;

    const next = [...value];
    for (const name of names) {
      // Prefer existing tag ID if name matches
      const existing = availableTags.find((t) => t.name.toLowerCase() === name.toLowerCase());
      const key = existing ? existing.id : name;
      if (!next.some((v) => v.toLowerCase() === key.toLowerCase() || v.toLowerCase() === name.toLowerCase())) {
        next.push(key);
      }
    }
    onChange(next);
    setInputValue('');
  };

  const removeTag = (name: string) => {
    const next = value.filter((v) => {
      const tag = availableTags.find((t) => t.id === v || t.name === v);
      return (tag ? tag.name : v).toLowerCase() !== name.toLowerCase();
    });
    onChange(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (inputValue.trim()) {
        addTag(inputValue);
      }
    } else if (e.key === 'Backspace' && inputValue === '' && value.length > 0) {
      removeTag(selectedTags[selectedTags.length - 1].name);
    }
  };

  return (
    <div className="relative">
    <div
      className={`min-h-[42px] w-full bg-bg-primary border rounded-[2px] px-3 py-2 flex flex-wrap items-center gap-2 transition-colors ${
        disabled ? 'opacity-60 cursor-not-allowed' : ''
      } ${isFocused ? 'border-network-primary/50' : 'border-border-color'}`}
      onClick={() => !disabled && inputRef.current?.focus()}
    >
      {selectedTags.map((tag) => (
        <span
          key={tag.name}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border"
          style={{
            borderColor: (tag.color || '#8b949e') + '50',
            backgroundColor: (tag.color || '#8b949e') + '20',
            color: tag.color || '#8b949e',
          }}
        >
          <Tag className="w-3 h-3" />
          {tag.name}
          {!disabled && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeTag(tag.name);
              }}
              className="ml-0.5 hover:opacity-70"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setTimeout(() => setIsFocused(false), 150)}
        placeholder={value.length === 0 ? placeholder : ''}
        disabled={disabled}
        className="flex-1 min-w-[120px] bg-transparent text-sm text-text-primary placeholder-text-secondary focus:outline-none disabled:cursor-not-allowed"
      />
      {isLoading && <Loader2 className="w-4 h-4 text-text-muted animate-spin" />}

      {/* Suggestions dropdown */}
      {isFocused && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 max-h-48 overflow-y-auto bg-bg-secondary border border-border-color rounded-[2px] z-10">
          {suggestions.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => addTag(tag.name)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/[0.05] transition-colors"
            >
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
              <span className="text-text-primary">{tag.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
    </div>
  );
};

export default TagSelector;
