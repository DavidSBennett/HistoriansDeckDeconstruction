<?php
// Canonical JSON for comparing a PHP value with a JS one: object keys sorted, and an empty object written
// the same as an empty list ("[]"), because PHP cannot tell them apart once decoded. Matches
// tools/lib/canon.mjs character for character.
declare(strict_types=1);

namespace HistDeck;

const CANON_FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_LINE_TERMINATORS;

function canon($x): string
{
    if ($x instanceof \stdClass) {
        return canonObject(get_object_vars($x));
    }
    if (is_array($x)) {
        if (array_is_list($x)) {
            return '[' . implode(',', array_map('HistDeck\\canon', $x)) . ']';
        }
        return canonObject($x);
    }
    return json_encode($x, CANON_FLAGS | JSON_THROW_ON_ERROR);
}

function canonObject(array $a): string
{
    if (!$a) {
        return '[]';
    }
    $keys = array_map('strval', array_keys($a));
    sort($keys, SORT_STRING);
    $parts = [];
    foreach ($keys as $k) {
        $parts[] = json_encode($k, CANON_FLAGS | JSON_THROW_ON_ERROR) . ':' . canon($a[$k]);
    }
    return '{' . implode(',', $parts) . '}';
}

function canonHash($x): string
{
    return hash('sha256', canon($x));
}
