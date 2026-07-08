import { chunkArray, deepMerge, removeEmptyValues, prefixKeys } from '../../src/utils/obj'

test('deepMerge', () => {
  expect(deepMerge({ a: 'foo' }, { a: 'bar' })).toMatchInlineSnapshot(`
        Object {
          "a": "bar",
        }
    `)
  expect(deepMerge({ a: 'foo' }, { b: 'bar' })).toMatchInlineSnapshot(`
        Object {
          "a": "foo",
          "b": "bar",
        }
    `)
  expect(deepMerge({ a: { b: { first: 1, second: 2, third: 3 } } }, { a: { b: { second: 4 } } }))
    .toMatchInlineSnapshot(`
        Object {
          "a": Object {
            "b": Object {
              "first": 1,
              "second": 4,
              "third": 3,
            },
          },
        }
    `)
  expect(deepMerge({ a: { b: { first: 1, second: 2, third: 3 } } }, { a: { b: { second: 4, fourth: 2 } } }))
    .toMatchInlineSnapshot(`
        Object {
          "a": Object {
            "b": Object {
              "first": 1,
              "fourth": 2,
              "second": 4,
              "third": 3,
            },
          },
        }
    `)
})

test('removeEmptyValues', () => {
  expect({ a: undefined, foo: null, yo: 'yo' }).toMatchInlineSnapshot(`
        Object {
          "a": undefined,
          "foo": null,
          "yo": "yo",
        }
    `)
  expect(removeEmptyValues({ a: undefined, foo: null, yo: 'yo' })).toMatchInlineSnapshot(`
        Object {
          "yo": "yo",
        }
    `)
})

test('chunkArray', () => {
  expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  expect(chunkArray([1, 2, 3], 3)).toEqual([[1, 2, 3]])
  expect(chunkArray([1, 2, 3], 10)).toEqual([[1, 2, 3]])
  expect(chunkArray([], 5)).toEqual([])
})

test('chunkArray does not mutate its input', () => {
  // Regression test: chunkArray used to splice() items out of the caller's array,
  // so retrying/splitting a batch with the same array sent zero requests and
  // resolved with an empty (fake-success) response set.
  const input = [1, 2, 3, 4, 5]
  const first = chunkArray(input, 5)
  expect(input).toEqual([1, 2, 3, 4, 5])
  expect(first).toEqual([[1, 2, 3, 4, 5]])
  // simulate the batch-split retry: same array, more splits
  const second = chunkArray(input, 3)
  expect(second).toEqual([[1, 2, 3], [4, 5]])
  expect(input).toEqual([1, 2, 3, 4, 5])
})

test('chunkArray clamps invalid chunk sizes', () => {
  expect(chunkArray([1, 2], 0)).toEqual([[1], [2]])
  expect(chunkArray([1, 2], NaN)).toEqual([[1], [2]])
})

test('prefixKeys', () => {
  expect(
    prefixKeys(
      {
        some: 123,
        foo: 47.11,
        bar: 8.15
      },
      'some.metric.'
    )
  ).toMatchInlineSnapshot(`
        Object {
          "some.metric.bar": 8.15,
          "some.metric.foo": 47.11,
          "some.metric.some": 123,
        }
    `)
})
