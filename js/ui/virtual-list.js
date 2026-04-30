// ============================================================
// VIRTUAL-LIST.JS — Virtual scrolling for long lists
// 
// Provides efficient rendering of large datasets by only
// rendering visible items in the viewport.
//
// Usage:
//   import { createVirtualList } from './ui/virtual-list.js';
//   const vList = createVirtualList({
//     container: document.getElementById('list'),
//     items: dataArray,
//     itemHeight: 80,
//     renderItem: (item) => createItemElement(item)
//   });
// ============================================================

/**
 * Create a virtual list instance
 * @param {Object} options Configuration options
 * @param {HTMLElement} options.container - Container element for the list
 * @param {Array} options.items - Array of items to render
 * @param {number} options.itemHeight - Height of each item in pixels
 * @param {Function} options.renderItem - Function to render a single item
 * @param {number} [options.buffer=5] - Number of extra items to render above/below viewport
 * @param {Function} [options.onScroll] - Optional scroll callback
 * @returns {Object} Virtual list API
 */
export function createVirtualList({
    container,
    items = [],
    itemHeight = 80,
    renderItem,
    buffer = 5,
    onScroll = null
}) {
    if (!container || !renderItem) {
        console.error('[virtual-list] Invalid configuration');
        return null;
    }

    // State
    let _items = [...items];
    let _scrollTop = 0;
    let _visibleStart = 0;
    let _visibleEnd = 0;
    let _renderedRange = { start: -1, end: -1 };

    // Create viewport structure
    const viewport = document.createElement('div');
    viewport.style.cssText = 'position:relative;overflow-y:auto;contain:strict;';
    viewport.style.height = container.style.height || '500px';

    // Spacer to maintain scroll height
    const spacer = document.createElement('div');
    spacer.style.cssText = 'position:absolute;top:0;left:0;right:0;pointer-events:none;';

    // Content container for visible items
    const content = document.createElement('div');
    content.style.cssText = 'position:absolute;top:0;left:0;right:0;';

    viewport.appendChild(spacer);
    viewport.appendChild(content);

    // Clear container and add viewport
    container.innerHTML = '';
    container.appendChild(viewport);

    // Item pool for reuse
    const _itemPool = new Map();
    const _activeItems = new Map();

    /**
     * Get or create an item element from the pool
     */
    function _getItemElement(index) {
        if (_activeItems.has(index)) {
            return _activeItems.get(index);
        }

        let el;
        // Try to reuse from pool
        for (const [key, pooled] of _itemPool) {
            el = pooled;
            _itemPool.delete(key);
            break;
        }

        if (!el) {
            el = document.createElement('div');
            el.style.cssText = `position:absolute;width:100%;height:${itemHeight}px;`;
        }

        // Update position and content
        el.style.top = `${index * itemHeight}px`;
        el.style.transform = `translateY(0)`;

        // Render content
        el.innerHTML = '';
        const item = _items[index];
        if (item) {
            const content = renderItem(item, index);
            if (content) {
                el.appendChild(content);
            }
        }

        _activeItems.set(index, el);
        return el;
    }

    /**
     * Return an element to the pool
     */
    function _recycleItemElement(index) {
        const el = _activeItems.get(index);
        if (el) {
            _itemPool.set(index, el);
            _activeItems.delete(index);
        }
    }

    /**
     * Calculate visible range based on scroll position
     */
    function _calculateVisibleRange() {
        const viewportHeight = viewport.clientHeight;
        const totalHeight = _items.length * itemHeight;

        // Calculate visible start/end indices
        const visibleStart = Math.max(0, Math.floor(_scrollTop / itemHeight) - buffer);
        const visibleEnd = Math.min(
            _items.length - 1,
            Math.ceil((_scrollTop + viewportHeight) / itemHeight) + buffer
        );

        return { visibleStart, visibleEnd };
    }

    /**
     * Render visible items
     */
    function _render() {
        const { visibleStart, visibleEnd } = _calculateVisibleRange();

        // Skip if range hasn't changed
        if (visibleStart === _renderedRange.start && visibleEnd === _renderedRange.end) {
            return;
        }

        // Recycle items that are no longer visible
        for (const [index, el] of _activeItems) {
            if (index < visibleStart || index > visibleEnd) {
                _recycleItemElement(index);
                if (el.parentNode) {
                    content.removeChild(el);
                }
            }
        }

        // Add newly visible items
        for (let i = visibleStart; i <= visibleEnd; i++) {
            if (!_activeItems.has(i)) {
                const el = _getItemElement(i);
                content.appendChild(el);
            }
        }

        _renderedRange = { start: visibleStart, end: visibleEnd };
        _visibleStart = visibleStart;
        _visibleEnd = visibleEnd;
    }

    /**
     * Handle scroll events with requestAnimationFrame
     */
    let _rafId = null;
    function _handleScroll() {
        if (_rafId) return;

        _rafId = requestAnimationFrame(() => {
            _scrollTop = viewport.scrollTop;

            _render();

            if (onScroll) {
                onScroll({
                    scrollTop: _scrollTop,
                    visibleStart: _visibleStart,
                    visibleEnd: _visibleEnd,
                    totalItems: _items.length
                });
            }

            _rafId = null;
        });
    }

    // Attach scroll listener
    viewport.addEventListener('scroll', _handleScroll, { passive: true });

    // Initial render
    _updateSpacer();
    _render();

    // Public API
    return {
        /**
         * Update the items list
         */
        updateItems(newItems) {
            _items = [...newItems];
            _updateSpacer();
            _render();
        },

        /**
         * Append items to the list
         */
        appendItems(newItems) {
            _items.push(...newItems);
            _updateSpacer();
            _render();
        },

        /**
         * Prepend items to the list
         */
        prependItems(newItems) {
            const oldLength = _items.length;
            _items.unshift(...newItems);
            _updateSpacer();

            // Adjust scroll position to maintain visual position
            const addedHeight = newItems.length * itemHeight;
            viewport.scrollTop = _scrollTop + addedHeight;

            _render();
        },

        /**
         * Remove an item by index
         */
        removeItem(index) {
            if (index >= 0 && index < _items.length) {
                _items.splice(index, 1);
                _updateSpacer();
                _render();
            }
        },

        /**
         * Update a single item
         */
        updateItem(index, newItem) {
            if (index >= 0 && index < _items.length) {
                _items[index] = newItem;

                // Re-render if visible
                if (index >= _visibleStart && index <= _visibleEnd) {
                    const el = _activeItems.get(index);
                    if (el) {
                        el.innerHTML = '';
                        const content = renderItem(newItem, index);
                        if (content) {
                            el.appendChild(content);
                        }
                    }
                }
            }
        },

        /**
         * Scroll to a specific index
         */
        scrollToIndex(index, alignToTop = true) {
            index = Math.max(0, Math.min(index, _items.length - 1));
            const targetScroll = index * itemHeight;

            if (alignToTop) {
                viewport.scrollTop = targetScroll;
            } else {
                viewport.scrollTop = targetScroll - viewport.clientHeight + itemHeight;
            }
        },

        /**
         * Get current visible range
         */
        getVisibleRange() {
            return { start: _visibleStart, end: _visibleEnd };
        },

        /**
         * Get total item count
         */
        getItemCount() {
            return _items.length;
        },

        /**
         * Refresh/re-render all visible items
         */
        refresh() {
            _render();
        },

        /**
         * Destroy the virtual list
         */
        destroy() {
            viewport.removeEventListener('scroll', _handleScroll);
            if (_rafId) {
                cancelAnimationFrame(_rafId);
            }

            // Clear pools
            _activeItems.clear();
            _itemPool.clear();

            container.innerHTML = '';
        }
    };

    /**
     * Update spacer height to match total content height
     */
    function _updateSpacer() {
        spacer.style.height = `${_items.length * itemHeight}px`;
    }
}

/**
 * Simple virtual list for tables
 * Similar to createVirtualList but optimized for table rows
 */
export function createVirtualTable({
    container,
    items = [],
    rowHeight = 48,
    renderRow,
    buffer = 5,
    onScroll = null
}) {
    if (!container || !renderRow) {
        console.error('[virtual-table] Invalid configuration');
        return null;
    }

    // State
    let _items = [...items];
    let _scrollTop = 0;
    let _visibleStart = 0;
    let _visibleEnd = 0;
    let _renderedRange = { start: -1, end: -1 };

    // Create structure
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative;overflow-y:auto;contain:strict;';
    wrapper.style.height = container.style.height || '500px';

    const spacer = document.createElement('div');
    spacer.style.cssText = 'position:absolute;top:0;left:0;right:0;pointer-events:none;';

    const table = document.createElement('table');
    table.style.cssText = 'position:absolute;top:0;left:0;right:0;width:100%;';
    table.id = 'virtual-table-element';

    wrapper.appendChild(spacer);
    wrapper.appendChild(table);

    container.innerHTML = '';
    container.appendChild(wrapper);

    // Row pool
    const _rowPool = [];
    const _activeRows = new Map();

    function _getRowElement(index) {
        if (_activeRows.has(index)) {
            return _activeRows.get(index);
        }

        let row = _rowPool.pop();

        if (!row) {
            row = document.createElement('tr');
            row.style.cssText = `position:absolute;height:${rowHeight}px;`;
        }

        row.style.top = `${index * rowHeight}px`;

        // Render content
        row.innerHTML = '';
        const item = _items[index];
        if (item) {
            const cells = renderRow(item, index);
            if (cells) {
                cells.forEach(cell => row.appendChild(cell));
            }
        }

        _activeRows.set(index, row);
        return row;
    }

    function _recycleRowElement(index) {
        const row = _activeRows.get(index);
        if (row) {
            _rowPool.push(row);
            _activeRows.delete(index);
        }
    }

    function _calculateVisibleRange() {
        const viewportHeight = wrapper.clientHeight;
        const visibleStart = Math.max(0, Math.floor(_scrollTop / rowHeight) - buffer);
        const visibleEnd = Math.min(
            _items.length - 1,
            Math.ceil((_scrollTop + viewportHeight) / rowHeight) + buffer
        );

        return { visibleStart, visibleEnd };
    }

    let _rafId = null;
    function _handleScroll() {
        if (_rafId) return;

        _rafId = requestAnimationFrame(() => {
            _scrollTop = wrapper.scrollTop;
            const { visibleStart, visibleEnd } = _calculateVisibleRange();

            if (visibleStart !== _renderedRange.start || visibleEnd !== _renderedRange.end) {
                // Recycle out-of-view rows
                for (const [index, row] of _activeRows) {
                    if (index < visibleStart || index > visibleEnd) {
                        _recycleRowElement(index);
                        if (row.parentNode) {
                            table.removeChild(row);
                        }
                    }
                }

                // Add newly visible rows
                for (let i = visibleStart; i <= visibleEnd; i++) {
                    if (!_activeRows.has(i)) {
                        const row = _getRowElement(i);
                        table.appendChild(row);
                    }
                }

                _renderedRange = { start: visibleStart, end: visibleEnd };
                _visibleStart = visibleStart;
                _visibleEnd = visibleEnd;
            }

            if (onScroll) {
                onScroll({
                    scrollTop: _scrollTop,
                    visibleStart: _visibleStart,
                    visibleEnd: _visibleEnd,
                    totalItems: _items.length
                });
            }

            _rafId = null;
        });
    }

    wrapper.addEventListener('scroll', _handleScroll, { passive: true });

    _updateSpacer();
    _render();

    function _render() {
        const { visibleStart, visibleEnd } = _calculateVisibleRange();

        if (visibleStart === _renderedRange.start && visibleEnd === _renderedRange.end) {
            return;
        }

        for (const [index, row] of _activeRows) {
            if (index < visibleStart || index > visibleEnd) {
                _recycleRowElement(index);
                if (row.parentNode) {
                    table.removeChild(row);
                }
            }
        }

        for (let i = visibleStart; i <= visibleEnd; i++) {
            if (!_activeRows.has(i)) {
                const row = _getRowElement(i);
                table.appendChild(row);
            }
        }

        _renderedRange = { start: visibleStart, end: visibleEnd };
        _visibleStart = visibleStart;
        _visibleEnd = visibleEnd;
    }

    function _updateSpacer() {
        spacer.style.height = `${_items.length * rowHeight}px`;
    }

    return {
        updateItems(newItems) {
            _items = [...newItems];
            _updateSpacer();
            _render();
        },

        appendItems(newItems) {
            _items.push(...newItems);
            _updateSpacer();
            _render();
        },

        removeItem(index) {
            if (index >= 0 && index < _items.length) {
                _items.splice(index, 1);
                _updateSpacer();
                _render();
            }
        },

        updateItem(index, newItem) {
            if (index >= 0 && index < _items.length) {
                _items[index] = newItem;
                if (index >= _visibleStart && index <= _visibleEnd) {
                    const row = _activeRows.get(index);
                    if (row) {
                        row.innerHTML = '';
                        const cells = renderRow(newItem, index);
                        if (cells) {
                            cells.forEach(cell => row.appendChild(cell));
                        }
                    }
                }
            }
        },

        scrollToIndex(index, alignToTop = true) {
            index = Math.max(0, Math.min(index, _items.length - 1));
            const targetScroll = index * rowHeight;
            if (alignToTop) {
                wrapper.scrollTop = targetScroll;
            } else {
                wrapper.scrollTop = targetScroll - wrapper.clientHeight + rowHeight;
            }
        },

        getVisibleRange() {
            return { start: _visibleStart, end: _visibleEnd };
        },

        getItemCount() {
            return _items.length;
        },

        refresh() {
            _render();
        },

        destroy() {
            wrapper.removeEventListener('scroll', _handleScroll);
            if (_rafId) {
                cancelAnimationFrame(_rafId);
            }
            _activeRows.clear();
            _rowPool.length = 0;
            container.innerHTML = '';
        }
    };
}

/**
 * Threshold for enabling virtualization
 * Only use virtual lists when item count exceeds this
 */
export const VIRTUALIZATION_THRESHOLD = 50;

/**
 * Smart list renderer that chooses between virtual and regular rendering
 */
export function renderSmartList({
    container,
    items = [],
    itemHeight = 80,
    renderItem,
    emptyMessage = 'No items',
    threshold = VIRTUALIZATION_THRESHOLD
}) {
    // Clean up any existing virtual list
    if (container._virtualList) {
        container._virtualList.destroy();
        container._virtualList = null;
    }

    if (items.length === 0) {
        container.innerHTML = `<div style="text-align:center;padding:40px;color:#64748b;">${emptyMessage}</div>`;
        return null;
    }

    if (items.length < threshold) {
        // Use regular rendering for small lists
        container.innerHTML = '';
        items.forEach((item, index) => {
            const el = renderItem(item, index);
            if (el) container.appendChild(el);
        });
        return null;
    }

    // Use virtual list for large lists
    const vList = createVirtualList({
        container,
        items,
        itemHeight,
        renderItem,
        buffer: 5
    });

    container._virtualList = vList;
    return vList;
}