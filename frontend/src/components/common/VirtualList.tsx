import React from 'react';
import { FixedSizeList, ListChildComponentProps } from 'react-window';

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  className?: string;
  overscanCount?: number;
  height?: number;
}

interface RowData<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
}

const RowComponent = <T,>(props: ListChildComponentProps<RowData<T>>): React.ReactElement | null => {
  const { index, style, data } = props;
  const { items, renderItem } = data;
  return <div style={style}>{renderItem(items[index], index)}</div>;
};

export function VirtualList<T>({
  items,
  itemHeight,
  renderItem,
  className = '',
  overscanCount = 5,
  height = 600,
}: VirtualListProps<T>) {
  const itemData = React.useMemo<RowData<T>>(
    () => ({ items, renderItem }),
    [items, renderItem]
  );

  return (
    <div className={`w-full h-full ${className}`}>
      <FixedSizeList
        height={height}
        itemCount={items.length}
        itemSize={itemHeight}
        overscanCount={overscanCount}
        itemData={itemData}
        width="100%"
      >
        {RowComponent as React.ComponentType<ListChildComponentProps<RowData<T>>>}
      </FixedSizeList>
    </div>
  );
}

export default VirtualList;
