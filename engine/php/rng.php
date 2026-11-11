<?php
// Port of engine/js/rng.mjs, plus the one piece of V8 behaviour the bots depend on (v8sort).
// PHP integers are 64-bit, so every 32-bit step of mulberry32 is masked by hand.
declare(strict_types=1);

namespace HistDeck;

/** Wraps an integer to a signed 32-bit value, like JavaScript's `x | 0`. */
function i32(int $x): int
{
    $x &= 0xFFFFFFFF;
    return $x >= 0x80000000 ? $x - 0x100000000 : $x;
}

/** JavaScript's `x >>> n` for a 32-bit value. */
function urs(int $x, int $n): int
{
    return ($x & 0xFFFFFFFF) >> $n;
}

/** JavaScript's Math.imul: the low 32 bits of a 32-bit product, signed. */
function imul(int $a, int $b): int
{
    $a &= 0xFFFFFFFF;
    $b &= 0xFFFFFFFF;
    $lo = (($a & 0xFFFF) * $b) & 0xFFFFFFFF;          // < 2^48 before masking
    $hi = ((($a >> 16) * $b) & 0xFFFF) << 16;          // only the low 16 bits survive the shift
    return i32($lo + $hi);
}

/** mulberry32 with its state in $S['rng']; returns a float in [0, 1), bit-identical to the JS engine. */
function random(array &$S): float
{
    $a = i32(i32((int) $S['rng']) + 0x6D2B79F5);
    $S['rng'] = $a;
    $t = imul($a ^ urs($a, 15), 1 | $a);
    $t = i32(i32($t + imul($t ^ urs($t, 7), 61 | $t)) ^ $t);
    return (($t ^ urs($t, 14)) & 0xFFFFFFFF) / 4294967296;
}

/** Fisher-Yates from the end, one random number per position. Returns the shuffled list. */
function shuffle_list(array &$S, array $a): array
{
    for ($i = count($a) - 1; $i > 0; $i--) {
        $j = (int) floor(random($S) * ($i + 1));
        [$a[$i], $a[$j]] = [$a[$j], $a[$i]];
    }
    return $a;
}

/**
 * Sorts a list exactly as V8's Array.prototype.sort does, calling the comparator in the same order.
 *
 * This matters only when the comparator has side effects: the bots break ties with random(), so the number
 * of random numbers drawn, and so the rest of the game, depends on the sort algorithm. V8 uses TimSort; for
 * fewer than 64 elements that is one run found by CountAndMakeRun, extended by BinaryInsertionSort. For 64 or
 * more, any stable sort gives V8's result as long as the comparator is consistent, which the engine's are.
 */
function v8sort(array $a, callable $cmp): array
{
    $a = array_values($a);
    $n = count($a);
    if ($n < 2) {
        return $a;
    }
    if ($n >= 64) {
        usort($a, static function ($x, $y) use ($cmp): int {
            $c = $cmp($x, $y);
            return $c < 0 ? -1 : ($c > 0 ? 1 : 0);
        });
        return $a;
    }
    // CountAndMakeRun(0, n)
    $run = 2;
    $descending = $cmp($a[1], $a[0]) < 0;
    $prev = $a[1];
    for ($i = 2; $i < $n; $i++) {
        $order = $cmp($a[$i], $prev);
        if ($descending ? $order >= 0 : $order < 0) {
            break;
        }
        $prev = $a[$i];
        $run++;
    }
    if ($descending) {
        for ($lo = 0, $hi = $run - 1; $lo < $hi; $lo++, $hi--) {
            [$a[$lo], $a[$hi]] = [$a[$hi], $a[$lo]];
        }
    }
    // BinaryInsertionSort(0, run, n)
    for ($start = $run; $start < $n; $start++) {
        $left = 0;
        $right = $start;
        $pivot = $a[$start];
        while ($left < $right) {
            $mid = $left + (($right - $left) >> 1);
            if ($cmp($pivot, $a[$mid]) < 0) {
                $right = $mid;
            } else {
                $left = $mid + 1;
            }
        }
        for ($p = $start; $p > $left; $p--) {
            $a[$p] = $a[$p - 1];
        }
        $a[$left] = $pivot;
    }
    return $a;
}
