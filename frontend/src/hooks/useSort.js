/** Click-to-sort state for a table: which column, which direction, and the rows in that order. */

import { useMemo, useState } from 'react'

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** Orders two values: numbers numerically, text alphabetically ignoring case; empty values always last. */
function compareValues(a, b, direction) {
  const aEmpty = a === null || a === undefined || a === ''
  const bEmpty = b === null || b === undefined || b === ''
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1
  const order = typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(String(a), String(b))
  return direction === 'asc' ? order : -order
}

/**
 * `columns` maps each sortable column key to a function returning the value to sort by for a row. Rows keep
 * their original order until a heading is clicked; clicking the sorted column again reverses it. Ties keep
 * their original order. Returns { sorted, sort, toggle } for use with <SortableCell>.
 */
export function useSort(rows, columns) {
  const [sort, setSort] = useState(null)
  const sorted = useMemo(() => {
    if (!rows || !sort) return rows
    const valueOf = columns[sort.key]
    return rows
      .map((row, index) => ({ row, index, value: valueOf(row) }))
      .sort((a, b) => compareValues(a.value, b.value, sort.direction) || a.index - b.index)
      .map(({ row }) => row)
  }, [rows, columns, sort])
  const toggle = (key) => setSort((current) => (
    current?.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' }))
  return { sorted, sort, toggle }
}
