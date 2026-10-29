import React from 'react';

export function AdminSortButton({ column: [key, label], sort, onSort }) {
  const active = sort?.key === key;
  const next = active && sort.direction === 'asc' ? '내림차순' : '오름차순';
  return (
    <button
      type="button"
      className={`column-sort${active ? ' active' : ''}`}
      aria-label={`${label} 정렬`}
      title={`${label} ${next} 정렬`}
      onClick={() =>
        onSort({ key, direction: active && sort.direction === 'asc' ? 'desc' : 'asc' })
      }
    >
      {label}
      <svg width="12" height="16" viewBox="0 0 12 16" aria-hidden="true">
        <path d="M6 2 10 6H2Z" opacity={active && sort.direction === 'asc' ? 1 : 0.35} />
        <path d="m6 14 4-4H2Z" opacity={active && sort.direction === 'desc' ? 1 : 0.35} />
      </svg>
    </button>
  );
}

export function AdminSortHeader(props) {
  const active = props.sort?.key === props.column[0];
  return (
    <span
      role="columnheader"
      aria-sort={active ? (props.sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <AdminSortButton {...props} />
    </span>
  );
}
