<?php
// Port of engine/js/view.mjs: what one seat may see. The server sends nothing else to a client.
declare(strict_types=1);

namespace HistDeck;

const PRIVATE_FIELDS = [
    'draft' => ['cards'],
    'organize' => ['cards'],
    'research' => ['got', 'back'],
    'article' => ['other'],
    'book' => ['hand'],
    'network' => ['out', 'disc'],
    'buy' => ['disc'],
];

function redactEvent(array $e, ?int $seat): array
{
    $hide = PRIVATE_FIELDS[$e['type']] ?? null;
    if (!$hide || ($e['seat'] ?? null) === $seat) {
        return $e;
    }
    foreach ($hide as $f) {
        unset($e[$f]);
    }
    return $e;
}

function eventCards(array $e): array
{
    $out = [];
    foreach (['source', 'show', 'other', 'out'] as $k) {
        if (isset($e[$k]) && is_int($e[$k])) {
            $out[] = $e[$k];
        }
    }
    foreach (['cards', 'got', 'back', 'hand', 'shelf', 'disc'] as $k) {
        if (isset($e[$k]) && is_array($e[$k])) {
            array_push($out, ...$e[$k]);
        }
    }
    return $out;
}

/**
 * The view for $seat (null for a spectator). Maps that JavaScript sends as objects (cards, stacks, market)
 * are returned as stdClass so json_encode keeps them objects even when empty.
 */
function view(array $S, array $R, $seat): array
{
    $me = (is_int($seat) && $seat >= 0 && $seat < count($S['players'])) ? $seat : null;
    $visible = [];
    $see = static function (array $uids) use (&$visible) {
        foreach ($uids as $u) {
            $visible[$u] = true;
        }
    };

    $players = [];
    foreach ($S['players'] as $p) {
        $mine = $p['i'] === $me;
        $see($p['play']);
        $see(array_map(static fn($e) => $e['uid'], $p['shelf']));
        if ($mine) {
            $see($p['hand']);
            $see($p['discard']);
        }
        $players[] = [
            'i' => $p['i'], 'name' => $p['name'], 'bot' => $p['bot'], 'field' => $p['field'],
            'prestige' => $p['prestige'], 'cites' => $p['cites'], 'trash' => $p['trash'],
            'cv' => $p['cv'],
            'shelf' => array_map(static fn($e) => ['uid' => $e['uid'], 'usedBy' => $e['usedBy']], $p['shelf']),
            'play' => $p['play'],
            'hand' => $mine ? $p['hand'] : null,
            'discard' => $mine ? $p['discard'] : null,
            'counts' => ['deck' => count($p['deck']), 'hand' => count($p['hand']), 'discard' => count($p['discard'])],
        ];
    }

    $pending = null;
    if ($S['pending']) {
        if ($S['pending']['seat'] === $me) {
            $pd = $S['pending'];
            $pending = ['seat' => $me, 'seen' => $pd['seen'], 'reject' => count($pd['seen']) - $pd['keepN'], 'keepN' => $pd['keepN'], 'L' => $pd['L'], 'toHand' => $pd['toHand']];
            $see($pd['seen']);
        } else {
            $pending = ['seat' => $S['pending']['seat']];
        }
    }

    $log = [];
    foreach ($S['log'] as $e) {
        $r = redactEvent($e, $me);
        $log[] = $r;
        $see(eventCards($r));
    }

    ksort($visible);
    $cards = [];
    foreach (array_keys($visible) as $u) {
        $cards[$u] = ['kind' => $S['cards'][$u]['kind'], 'ref' => $S['cards'][$u]['ref']];
    }
    $stacks = [];
    foreach ($S['stacks'] as $L => $a) {
        $stacks[$L] = count($a);
    }

    $buying = array_key_exists('returned', $S)
        ? ['returned' => (object) array_map(static fn($l) => array_values($l), $S['returned']), 'bought' => $S['bought']]
        : [];
    return [
        'v' => $S['v'], 'deckId' => $S['deckId'], 'you' => $me,
        'length' => $S['length'], 'round' => $S['round'], 'rounds' => $R['config']['rounds'][$S['length']],
        'phase' => $S['phase'], 'draftAt' => $S['draftAt'], 'turn' => $S['turn'], 'over' => $S['over'],
        'stacks' => (object) $stacks, 'market' => (object) $S['market'],
    ] + $buying + [
        'players' => $players, 'pending' => $pending, 'cards' => (object) $cards, 'log' => $log,
    ];
}
