<?php
// Port of engine/js/engine.mjs. Function for function, the same rules, error messages and events; the
// conformance test (engine/php/tests/conformance.php) replays games recorded by the JS engine and requires an
// identical state after every step. Change engine/js first, then port the change here.
//
// The state $S is the JSON state decoded as associative arrays. Lists must stay lists (array_values after
// filtering), or json_encode would turn them into objects.
declare(strict_types=1);

namespace HistDeck;

// ---------- small helpers ----------
function filt(array $a, callable $f): array
{
    return array_values(array_filter($a, $f));
}
function has(array $a, $v): bool
{
    return in_array($v, $a, true);
}
function take(array &$arr, $uid)
{
    $i = array_search($uid, $arr, true);
    if ($i === false) {
        return null;
    }
    array_splice($arr, $i, 1);
    return $uid;
}
function logEv(array &$S, array $ev): void
{
    $S['log'][] = ['r' => $S['round']] + $ev;
}

// ---------- card helpers ----------
function kindOf(array $S, int $u): string
{
    return $S['cards'][$u]['kind'];
}
function refOf(array $S, int $u)
{
    return $S['cards'][$u]['ref'];
}
function def(array $S, array $R, int $u): array
{
    return $R['actions'][$S['cards'][$u]['ref']];
}
function src(array $S, array $R, int $u): array
{
    return $R['cards'][$S['cards'][$u]['ref']];
}
function isSource(array $S, int $u): bool
{
    return $S['cards'][$u]['kind'] === 'source';
}
function isTrash(array $S, int $u): bool
{
    return $S['cards'][$u]['kind'] === 'trash';
}
function tagsOf(array $S, array $R, int $u): array
{
    $d = src($S, $R, $u);
    return ($d['sub'] ?? '') !== '' ? [$d['arg'], $d['sub']] : [$d['arg']];
}
function mk(array &$S, string $kind, $ref): int
{
    $u = ++$S['uidc'];
    $S['cards'][$u] = ['kind' => $kind, 'ref' => $ref];
    return $u;
}

// ---------- player helpers ----------
function trashCount(array $S, int $seat): int
{
    $p = $S['players'][$seat];
    return count(filt(array_merge($p['deck'], $p['hand'], $p['discard'], $p['play']), static fn($u) => isTrash($S, $u)));
}
function bonus(array $S, array $R, int $seat, string $type): int
{
    $p = $S['players'][$seat];
    $n = 0;
    foreach ($p['hand'] as $u) {
        if (isSource($S, $u) && src($S, $R, $u)['type'] === $type) {
            $n++;
        }
    }
    foreach ($p['shelf'] as $e) {
        if (src($S, $R, $e['uid'])['type'] === $type) {
            $n++;
        }
    }
    return $R['bonuses'][$type]['amt'] * $n;
}
function keepLimit(array $S, array $R, int $seat): int
{
    return $R['config']['keepCards'] ? $R['config']['keepCards'] + bonus($S, $R, $seat, 'Diary') : 0;
}
function books(array $p): int
{
    return count(filt($p['cv'], static fn($x) => $x['type'] === 'book'));
}
function allSources(array $S, array $p): array
{
    return filt(array_merge($p['deck'], $p['hand'], $p['discard']), static fn($u) => isSource($S, $u));
}
/** The shelf entry holding this card: ['owner' => seat, 'k' => index on that shelf, 'uid', 'usedBy'], or null. */
function findShelf(array $S, $uid): ?array
{
    foreach ($S['players'] as $q) {
        foreach ($q['shelf'] as $k => $e) {
            if ($e['uid'] === $uid) {
                return ['owner' => $q['i'], 'k' => $k, 'uid' => $e['uid'], 'usedBy' => $e['usedBy']];
            }
        }
    }
    return null;
}
function actCheck(array $S, array $R, int $seat, $a, string $kind): bool
{
    return has($S['players'][$seat]['hand'], $a) && kindOf($S, $a) === 'action' && def($S, $R, $a)['kind'] === $kind;
}
function playCard(array &$S, int $seat, int $a): void
{
    take($S['players'][$seat]['hand'], $a);
    $S['players'][$seat]['play'][] = $a;
}

// ---------- setup ----------
function newGame(array $R, array $seats, string $length, int $seed): array
{
    if (!array_key_exists($length, $R['config']['rounds'])) {
        throw new \InvalidArgumentException("Unknown game length: $length");
    }
    $S = [
        'v' => 1, 'deckId' => $R['deck']['id'] ?? null, 'seed' => $seed, 'rng' => i32($seed), 'uidc' => 0,
        'cards' => [null], 'players' => [], 'stacks' => [], 'market' => [], 'turn' => 0, 'round' => 1,
        'length' => $length, 'phase' => 'draft', 'draftAt' => 0, 'pending' => null, 'over' => false,
        'trashSeq' => 0, 'ti' => [], 'log' => [],
    ];
    foreach ($R['letters'] as $L) {
        $idx = [];
        foreach ($R['cards'] as $i => $d) {
            if ($d['arg'] === $L) {
                $idx[] = $i;
            }
        }
        $stack = [];
        foreach (shuffle_list($S, $idx) as $i) {
            $stack[] = mk($S, 'source', $i);
        }
        for ($k = 0; $k < $R['config']['trashPerStack']; $k++) {
            $stack[] = mk($S, 'trash', $S['trashSeq']++ % count($R['trash']));
        }
        $S['stacks'][$L] = shuffle_list($S, $stack);
        $S['ti'][$L] = ['a' => 0, 'b' => 0];
    }
    foreach ($R['piles'] as $pl) {
        $S['market'][$pl['pile']] = count($pl['tiers']);
    }
    foreach (array_values($seats) as $i => $s) {
        $deck = [];
        foreach ($R['base'] as $b) {
            $deck[] = mk($S, 'action', $b);
        }
        $S['players'][] = [
            'i' => $i, 'name' => $s['name'], 'bot' => !empty($s['bot']), 'deck' => $deck,
            'hand' => [], 'discard' => [], 'play' => [], 'shelf' => [], 'cv' => [],
            'prestige' => 0, 'cites' => 0, 'field' => null, 'trash' => null,
        ];
    }
    logEv($S, ['type' => 'start', 'rounds' => $R['config']['rounds'][$length]]);
    return $S;
}

function doDraft(array &$S, array $R, $L)
{
    $seat = $S['draftAt'];
    if ($S['phase'] !== 'draft' || !isset($S['players'][$seat])) {
        return 'Not drafting.';
    }
    $n = $R['config']['startCards'];
    if (!is_string($L) || !array_key_exists($L, $S['stacks']) || count($S['stacks'][$L]) < $n) {
        return 'Not enough cards left in that ' . $R['archiveWord'] . '.';
    }
    $got = array_slice($S['stacks'][$L], 0, $n);
    $S['stacks'][$L] = array_slice($S['stacks'][$L], $n);
    $S['players'][$seat]['deck'] = shuffle_list($S, array_merge($S['players'][$seat]['deck'], $got));
    $S['players'][$seat]['field'] = $L;
    $S['draftAt']++;
    logEv($S, ['type' => 'draft', 'seat' => $seat, 'L' => $L, 'n' => count($got), 'cards' => $got]);
    if ($S['draftAt'] >= count($S['players'])) {
        $S['phase'] = 'play';
        foreach ($S['players'] as $q) {
            draw($S, $q['i'], $R['config']['handSize']);
        }
    }
    return ['got' => $got];
}

function draw(array &$S, int $seat, int $n): int
{
    $k = 0;
    for ($i = 0; $i < $n; $i++) {
        if (!count($S['players'][$seat]['deck'])) {
            if (!count($S['players'][$seat]['discard'])) {
                break;
            }
            $S['players'][$seat]['deck'] = shuffle_list($S, $S['players'][$seat]['discard']);
            $S['players'][$seat]['discard'] = [];
        }
        $S['players'][$seat]['hand'][] = array_pop($S['players'][$seat]['deck']);
        $k++;
    }
    return $k;
}

// ---------- actions ----------
function doDraw(array &$S, array $R, int $seat, $a)
{
    if (!actCheck($S, $R, $seat, $a, 'draw')) {
        return 'Not a draw card.';
    }
    playCard($S, $seat, $a);
    $k = draw($S, $seat, def($S, $R, $a)['draw']);
    logEv($S, ['type' => 'playDraw', 'seat' => $seat, 'action' => refOf($S, $a), 'k' => $k]);
    return null;
}

function doOrganize(array &$S, array $R, int $seat, $a, array $uids)
{
    if (!actCheck($S, $R, $seat, $a, 'organize')) {
        return 'Not an organize card.';
    }
    if (!count($uids)) {
        return 'Choose at least one trash card.';
    }
    $p = $S['players'][$seat];
    foreach ($uids as $u) {
        if (!(has($p['hand'], $u) || has($p['discard'], $u)) || !isTrash($S, $u)) {
            return 'Only trash cards in your hand or discard pile.';
        }
    }
    playCard($S, $seat, $a);
    foreach ($uids as $u) {
        if (take($S['players'][$seat]['hand'], $u) === null) {
            take($S['players'][$seat]['discard'], $u);
        }
    }
    logEv($S, ['type' => 'organize', 'seat' => $seat, 'n' => count($uids), 'cards' => array_values($uids)]);
    return null;
}

function doResearch(array &$S, array $R, int $seat, $a, array $disc, $L, ?callable $chooser = null)
{
    if (!actCheck($S, $R, $seat, $a, 'research')) {
        return 'Not a research card.';
    }
    $d = def($S, $R, $a);
    $fixed = is_int($d['take'] ?? null);
    if ($fixed) {
        if (count($disc)) {
            return 'This Research card needs no discards.';
        }
    } else {
        if (!count($disc)) {
            return 'Discard at least one card.';
        }
        if (has($disc, $a)) {
            return 'Bad discard.';
        }
        foreach ($disc as $u) {
            if (!has($S['players'][$seat]['hand'], $u)) {
                return 'Bad discard.';
            }
        }
    }
    if (!is_string($L) || !array_key_exists($L, $S['stacks']) || !count($S['stacks'][$L])) {
        return 'That ' . $R['archiveWord'] . ' is empty.';
    }
    $look = bonus($S, $R, $seat, 'Map') + ($d['look'] ?? 0);
    playCard($S, $seat, $a);
    foreach ($disc as $u) {
        $S['players'][$seat]['discard'][] = take($S['players'][$seat]['hand'], $u);
    }
    $want = $fixed ? $d['take'] : count($disc) + ($d['bonus'] ?? 0);
    $n = min($want + $look, count($S['stacks'][$L]));
    $seen = array_slice($S['stacks'][$L], 0, $n);
    $S['stacks'][$L] = array_slice($S['stacks'][$L], $n);
    $pend = ['seat' => $seat, 'seen' => $seen, 'keepN' => min($want, count($seen)), 'toHand' => !empty($d['toHand']), 'L' => $L, 'n' => count($disc)];
    if (count($seen) <= $pend['keepN']) {
        return finishResearch($S, $R, $pend, []);
    }
    if ($chooser) {
        return finishResearch($S, $R, $pend, $chooser($S, $R, $seat, $seen, count($seen) - $pend['keepN']));
    }
    $S['pending'] = $pend;
    return ['pending' => true, 'seen' => $seen, 'reject' => count($seen) - $pend['keepN'], 'keepN' => $pend['keepN']];
}

function finishResearch(array &$S, array $R, array $pend, array $rej)
{
    $seat = $pend['seat'];
    $k = count($pend['seen']) - $pend['keepN'];
    $bad = count($rej) !== $k || count(array_unique($rej)) !== $k;
    foreach ($rej as $u) {
        if (!has($pend['seen'], $u)) {
            $bad = true;
        }
    }
    if ($bad) {
        return "Put back exactly $k.";
    }
    $got = filt($pend['seen'], static fn($u) => !has($rej, $u));
    $back = filt($pend['seen'], static fn($u) => has($rej, $u));
    foreach ($back as $u) {
        $S['stacks'][$pend['L']][] = $u;
    }
    $dest = $pend['toHand'] ? 'hand' : 'discard';
    foreach ($got as $u) {
        $S['players'][$seat][$dest][] = $u;
    }
    $S['pending'] = null;
    logEv($S, [
        'type' => 'research', 'seat' => $seat, 'n' => $pend['n'], 'L' => $pend['L'], 'seen' => count($pend['seen']),
        'took' => count($got), 'putBack' => count($back), 'toHand' => $pend['toHand'], 'got' => $got, 'back' => $back,
    ]);
    return ['got' => $got];
}

function doConference(array &$S, array $R, int $seat, $a, $s)
{
    if (!actCheck($S, $R, $seat, $a, 'conference')) {
        return 'Not a conference card.';
    }
    if (!has($S['players'][$seat]['hand'], $s) || !isSource($S, $s)) {
        return 'Choose one source.';
    }
    $d = src($S, $R, $s);
    $pts = ((def($S, $R, $a)['pts'] ?? 0) ?: $R['config']['paperPts']) + bonus($S, $R, $seat, 'Speech');
    playCard($S, $seat, $a);
    $S['players'][$seat]['discard'][] = take($S['players'][$seat]['hand'], $s);
    $S['players'][$seat]['prestige'] += $pts;
    $S['players'][$seat]['cv'][] = ['type' => 'paper', 'title' => $d['title'], 'letter' => $d['arg'], 'pts' => $pts];
    logEv($S, ['type' => 'conference', 'seat' => $seat, 'source' => $s, 'pts' => $pts]);
    return null;
}

function sameEra(array $S, array $R, int $a, int $b): bool
{
    return src($S, $R, $a)['era'] === src($S, $R, $b)['era'];
}

function doArticle(array &$S, array $R, int $seat, $a, $s1, $s2, $show)
{
    if (!actCheck($S, $R, $seat, $a, 'article')) {
        return 'Not an article card.';
    }
    $hand = $S['players'][$seat]['hand'];
    if (!has($hand, $s1) || !has($hand, $s2) || $s1 === $s2 || !isSource($S, $s1) || !isSource($S, $s2)) {
        return 'Choose two sources.';
    }
    if (!sameEra($S, $R, $s1, $s2)) {
        return 'The two sources must share an era.';
    }
    if ($show !== $s1 && $show !== $s2) {
        return 'Choose which card to showcase.';
    }
    $pts = $R['config']['articlePts'] + (def($S, $R, $a)['pts'] ?? 0) + bonus($S, $R, $seat, 'Report');
    playCard($S, $seat, $a);
    take($S['players'][$seat]['hand'], $s1);
    take($S['players'][$seat]['hand'], $s2);
    $sc = $show === $s1 ? $s1 : $s2;
    $other = $show === $s1 ? $s2 : $s1;
    $L = src($S, $R, $sc)['arg'];
    $S['players'][$seat]['shelf'][] = ['uid' => $sc, 'usedBy' => []];
    $S['players'][$seat]['discard'][] = $other;
    $S['players'][$seat]['prestige'] += $pts;
    $tl = $R['theses'][$L]['articles'];
    $title = $tl[$S['ti'][$L]['a']++ % count($tl)];
    $S['players'][$seat]['cv'][] = ['type' => 'article', 'title' => $title, 'letter' => $L, 'pts' => $pts];
    logEv($S, ['type' => 'article', 'seat' => $seat, 'title' => $title, 'pts' => $pts, 'show' => $sc, 'other' => $other]);
    return null;
}

/** Sets a group of source cards (card data arrays) scores in a book. */
function bookSets(array $R, array $defs): array
{
    $out = [];
    $nums = array_values(array_unique(array_map(static fn($d) => $d['num'], $defs)));
    sort($nums);
    $best = [];
    $run = [];
    foreach ($nums as $n) {
        if ($run && $n === $run[count($run) - 1] + 1) {
            $run[] = $n;
        } else {
            $run = [$n];
        }
        if (count($run) > count($best)) {
            $best = $run;
        }
    }
    if (count($best) >= $R['config']['runMin']) {
        $out[] = ['name' => 'Sequence', 'pts' => $R['config']['runPts'], 'why' => 'Nos. ' . $best[0] . "\u{2013}" . $best[count($best) - 1]];
    }
    $types = count(array_unique(array_map(static fn($d) => $d['type'], $defs)));
    if ($types >= $R['config']['typesMin']) {
        $out[] = ['name' => 'Range of Sources', 'pts' => $R['config']['typesPts'], 'why' => $types . ' source types'];
    }
    return $out;
}

function bookCardPts(array $R, int $n): int
{
    $t = $R['config']['bookCardPts'];
    $mx = max(array_map('intval', array_keys($t)));
    return $n <= $mx ? ($t[$n] ?? 0) : $t[$mx] + ($n - $mx) * ($t[$mx] - $t[$mx - 1] + 1);
}

function bookCheck(array $S, array $R, int $seat, array $ad, array $handUids, array $shelfUids): array
{
    $min = ($ad['min'] ?? 0) ?: $R['config']['bookMin'];
    $ents = [];
    foreach ($shelfUids as $u) {
        $f = findShelf($S, $u);
        if (!$f) {
            return ['ok' => false, 'msg' => 'Bad shelf card.'];
        }
        if (has($f['usedBy'], $seat)) {
            return ['ok' => false, 'msg' => "You have already used \u{201C}" . src($S, $R, $u)['title'] . "\u{201D} in a book."];
        }
        $ents[] = $f;
    }
    $all = array_merge($handUids, array_map(static fn($f) => $f['uid'], $ents));
    $n = count($all);
    foreach ($handUids as $u) {
        if (!isSource($S, $u)) {
            return ['ok' => false, 'msg' => 'Sources only.'];
        }
    }
    if ($n < $min) {
        return ['ok' => false, 'msg' => "$n of $min cards chosen."];
    }
    if (count($handUids) < min($R['config']['bookMinFromHand'], $min)) {
        return ['ok' => false, 'msg' => 'At least ' . $R['config']['bookMinFromHand'] . ' cards must come from your hand.'];
    }
    $ok = filt($R['letters'], static function ($L) use ($S, $R, $all) {
        foreach ($all as $u) {
            if (!in_array($L, tagsOf($S, $R, $u), true)) {
                return false;
            }
        }
        return true;
    });
    if (!$ok) {
        return ['ok' => false, 'msg' => 'The cards do not share a thesis letter.'];
    }
    $argCount = static fn($L) => count(filt($all, static fn($u) => src($S, $R, $u)['arg'] === $L));
    $ok = v8sort($ok, static fn($x, $y) => $argCount($y) - $argCount($x));
    $sets = bookSets($R, array_map(static fn($u) => src($S, $R, $u), $all));
    $base = bookCardPts($R, $n) + $R['config']['bookBonus'] + ($ad['pts'] ?? 0) + bonus($S, $R, $seat, 'Photograph');
    $pts = $base + array_sum(array_map(static fn($x) => $x['pts'], $sets));
    $sx = $sets
        ? ' Sets: ' . implode(', ', array_map(static fn($x) => $x['name'] . ' (' . $x['why'] . ') +' . $x['pts'], $sets)) . '.'
        : ' No sets yet.';
    return [
        'ok' => true, 'letter' => $ok[0], 'pts' => $pts, 'sets' => $sets, 'ents' => $ents, 'n' => $n,
        'msg' => "$n cards on thesis {$ok[0]}: $base base" . ($sets ? ' + ' . ($pts - $base) . ' in sets' : '') . " = $pts prestige." . $sx,
    ];
}

function doBook(array &$S, array $R, int $seat, $a, array $handUids, array $shelfUids, $showUid)
{
    if (!actCheck($S, $R, $seat, $a, 'book')) {
        return 'Not a book card.';
    }
    if ($showUid && !has($handUids, $showUid)) {
        return 'The showcased card must be one of the cards from your hand.';
    }
    foreach ($handUids as $u) {
        if (!has($S['players'][$seat]['hand'], $u)) {
            return 'Bad hand card.';
        }
    }
    $r = bookCheck($S, $R, $seat, def($S, $R, $a), $handUids, $shelfUids);
    if (!$r['ok']) {
        return $r['msg'];
    }
    playCard($S, $seat, $a);
    foreach ($handUids as $u) {
        take($S['players'][$seat]['hand'], $u);
        if ($u === $showUid) {
            $S['players'][$seat]['shelf'][] = ['uid' => $u, 'usedBy' => [$seat]];
        } elseif ($R['bookCardsTo'] === 'archive') {
            $S['stacks'][src($S, $R, $u)['arg']][] = $u;
        } else {
            $S['players'][$seat]['discard'][] = $u;
        }
    }
    $cited = [];
    foreach ($r['ents'] as $f) {
        $S['players'][$f['owner']]['shelf'][$f['k']]['usedBy'][] = $seat;
        if ($f['owner'] !== $seat) {
            $S['players'][$f['owner']]['prestige'] += $R['config']['citePts'] + bonus($S, $R, $f['owner'], 'Newspaper');
            $S['players'][$f['owner']]['cites']++;
            $cited[] = $f['owner'];
        }
    }
    $S['players'][$seat]['prestige'] += $r['pts'];
    $tl = $R['theses'][$r['letter']]['books'];
    $title = $tl[$S['ti'][$r['letter']]['b']++ % count($tl)];
    $S['players'][$seat]['cv'][] = ['type' => 'book', 'title' => $title, 'letter' => $r['letter'], 'pts' => $r['pts'], 'n' => $r['n']];
    logEv($S, [
        'type' => 'book', 'seat' => $seat, 'title' => $title, 'n' => $r['n'], 'L' => $r['letter'], 'pts' => $r['pts'],
        'sets' => array_map(static fn($x) => $x['name'], $r['sets']), 'show' => $showUid ?: null, 'cited' => $cited,
        'hand' => array_values($handUids), 'shelf' => array_values($shelfUids),
    ]);
    return null;
}

/** The tier the next buyer of a pile gets, or null if the pile is empty. */
function nextTier(array $S, array $R, $pileId)
{
    $pl = is_string($pileId) ? ($R['pileById'][$pileId] ?? null) : null;
    $left = $pl ? ($S['market'][$pileId] ?? 0) : 0;
    return $left ? $pl['tiers'][count($pl['tiers']) - $left] : null;
}

function doNetwork(array &$S, array $R, int $seat, $a, array $disc, $pileId, $repl)
{
    if (!actCheck($S, $R, $seat, $a, 'network')) {
        return 'Not a network card.';
    }
    $pl = is_string($pileId) ? ($R['pileById'][$pileId] ?? null) : null;
    if (!$pl || empty($S['market'][$pileId])) {
        return 'That upgrade is gone.';
    }
    if (!count($disc)) {
        return 'Discard at least one card.';
    }
    if (has($disc, $a)) {
        return 'Bad discard.';
    }
    foreach ($disc as $u) {
        if (!has($S['players'][$seat]['hand'], $u)) {
            return 'Bad discard.';
        }
    }
    if (count($disc) + (def($S, $R, $a)['bonus'] ?? 0) + bonus($S, $R, $seat, 'Letter') < $pl['value']) {
        return 'You need to discard more cards for that upgrade.';
    }
    if (!has($disc, $repl) && !has($S['players'][$seat]['discard'], $repl)) {
        return 'Choose a card in your discard pile to replace.';
    }
    $tier = nextTier($S, $R, $pileId);
    playCard($S, $seat, $a);
    foreach ($disc as $u) {
        $S['players'][$seat]['discard'][] = take($S['players'][$seat]['hand'], $u);
    }
    $out = take($S['players'][$seat]['discard'], $repl);
    if (isSource($S, $out)) {
        $S['stacks'][src($S, $R, $out)['arg']][] = $out;
    }
    $S['players'][$seat]['discard'][] = mk($S, 'action', $tier);
    $S['market'][$pileId]--;
    logEv($S, [
        'type' => 'network', 'seat' => $seat, 'n' => count($disc), 'pile' => $pileId, 'up' => $tier,
        'outKind' => kindOf($S, $out), 'outArchive' => isSource($S, $out) ? src($S, $R, $out)['arg'] : null,
        'out' => $out, 'disc' => array_values($disc),
    ]);
    return null;
}

function endTurn(array &$S, array $R, array $keepUids)
{
    $seat = $S['turn'];
    $lim = keepLimit($S, $R, $seat);
    $keep = [];
    foreach (array_slice(array_values($keepUids), 0, $lim) as $u) {
        $c = take($S['players'][$seat]['hand'], $u);
        if ($c !== null) {
            $keep[] = $c;
        }
    }
    $p = $S['players'][$seat];
    $S['players'][$seat]['discard'] = array_merge($p['discard'], $p['hand'], $p['play']);
    $kn = count($keep);
    $S['players'][$seat]['hand'] = $keep;
    $S['players'][$seat]['play'] = [];
    draw($S, $seat, max(0, $R['config']['handSize'] - $kn));
    logEv($S, ['type' => 'endTurn', 'seat' => $seat, 'kept' => $kn]);
    $S['turn'] = ($S['turn'] + 1) % count($S['players']);
    if ($S['turn'] === 0) {
        if ($S['round'] >= $R['config']['rounds'][$S['length']]) {
            $S['over'] = true;
            foreach (array_keys($S['players']) as $i) {
                $t = trashCount($S, $i);
                $S['players'][$i]['trash'] = $t;
                if ($t && $R['config']['trashPenalty']) {
                    $S['players'][$i]['prestige'] -= $t * $R['config']['trashPenalty'];
                    logEv($S, ['type' => 'trashPenalty', 'seat' => $i, 't' => $t, 'pts' => $t * $R['config']['trashPenalty']]);
                }
            }
            logEv($S, ['type' => 'over']);
            return null;
        }
        $S['round']++;
    }
    return null;
}

/** Players by prestige, then by number of books (stable). */
function ranking(array $S): array
{
    return v8sort($S['players'], static fn($a, $b) => ($b['prestige'] - $a['prestige']) ?: (books($b) - books($a)));
}
