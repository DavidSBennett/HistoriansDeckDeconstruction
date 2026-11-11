<?php
// Port of engine/js/bots.mjs. Every sort goes through v8sort(), so random tie-breaks draw the same numbers
// in the same order as the JS engine.
declare(strict_types=1);

namespace HistDeck;

function botDraft(array &$S, array $R)
{
    $Ls = v8sort($R['letters'], static function ($x, $y) use (&$S) {
        return (count($S['stacks'][$y]) - count($S['stacks'][$x])) ?: (random($S) - 0.5);
    });
    return doDraft($S, $R, $Ls[0]);
}

function botReject(array $S, array $R, int $seat, array $seen, int $k): array
{
    $p = $S['players'][$seat];
    $own = allSources($S, $p);
    $val = static function ($u) use ($S, $R, $p, $own) {
        if (!isSource($S, $u)) {
            return -1;
        }
        $arg = src($S, $R, $u)['arg'];
        return count(filt($own, static fn($x) => src($S, $R, $x)['arg'] === $arg))
            + count(filt($p['shelf'], static fn($e) => in_array($arg, tagsOf($S, $R, $e['uid']), true)))
            + (in_array($p['field'], tagsOf($S, $R, $u), true) ? 1 : 0);
    };
    return array_slice(v8sort($seen, static fn($x, $y) => $val($x) - $val($y)), 0, $k);
}

function botBook(array $S, array $R, int $seat, int $a): ?array
{
    $d = def($S, $R, $a);
    $min = ($d['min'] ?? 0) ?: $R['config']['bookMin'];
    $best = null;
    // One candidate per thesis letter, then (with False Leads) one made only of False Leads.
    $groups = [];
    foreach ($R['letters'] as $L) {
        $groups[] = static fn($u) => !isFalseLead($S, $R, $u) && in_array($L, tagsOf($S, $R, $u), true);
    }
    if (!empty($R['config']['falseLead'])) {
        $groups[] = static fn($u) => isFalseLead($S, $R, $u);
    }
    foreach ($groups as $fits) {
        $hs = filt($S['players'][$seat]['hand'], static fn($u) => isSource($S, $u) && $fits($u));
        if (count($hs) < min($R['config']['bookMinFromHand'], $min)) {
            continue;
        }
        $own = [];
        $riv = [];
        foreach ($S['players'] as $q) {
            foreach ($q['shelf'] as $e) {
                if ($fits($e['uid']) && !in_array($seat, $e['usedBy'], true)) {
                    if ($q['i'] === $seat) {
                        $own[] = $e['uid'];
                    } else {
                        $riv[] = $e['uid'];
                    }
                }
            }
        }
        for ($k = 0; $k <= count($riv); $k++) {
            $sh = array_merge($own, array_slice($riv, 0, $k));
            if (count($hs) + count($sh) < $min) {
                continue;
            }
            $r = bookCheck($S, $R, $seat, $d, $hs, $sh);
            if (!$r['ok']) {
                continue;
            }
            $val = $r['pts'] - $k * $R['config']['citePts'];
            if (!$best || $val > $best['val']) {
                $best = ['val' => $val, 'n' => $r['n'], 'h' => $hs, 'sh' => $sh, 'show' => $hs[0]];
            }
        }
    }
    return $best;
}

/** Plays one action for the current player; false when the bot has nothing more to do. */
function botStep(array &$S, array $R): bool
{
    $seat = $S['turn'];
    $H = static function (string $k) use (&$S, $R, $seat) {
        foreach ($S['players'][$seat]['hand'] as $u) {
            if (kindOf($S, $u) === 'action' && def($S, $R, $u)['kind'] === $k) {
                return $u;
            }
        }
        return null;
    };
    // Closures read $S by reference: an arrow function would capture a copy taken when it was created.
    $srcs = static function () use (&$S, $seat) {
        return filt($S['players'][$seat]['hand'], static fn($u) => isSource($S, $u));
    };

    if (($a = $H('organize')) !== null && empty(def($S, $R, $a)['returns'])) {
        $p = $S['players'][$seat];
        $t = filt(array_merge($p['hand'], $p['discard']), static fn($u) => isTrash($S, $u));
        if (count($t) && doOrganize($S, $R, $seat, $a, $t) === null) {
            return true;
        }
    }
    if (($a = $H('draw')) !== null) {
        doDraw($S, $R, $seat, $a);
        return true;
    }
    if (($a = $H('book')) !== null) {
        $b = botBook($S, $R, $seat, $a);
        if ($b && doBook($S, $R, $seat, $a, $b['h'], $b['sh'], $b['show']) === null) {
            return true;
        }
    }
    if (($a = $H('article')) !== null) {
        $s = $srcs();
        for ($i = 0; $i < count($s); $i++) {
            for ($j = $i + 1; $j < count($s); $j++) {
                if (articlePair($S, $R, $s[$i], $s[$j])) {
                    $show = isFalseLead($S, $R, $s[$i]) || (src($S, $R, $s[$i])['sub'] ?? '') !== '' ? $s[$i] : $s[$j];
                    if (doArticle($S, $R, $seat, $a, $s[$i], $s[$j], $show) === null) {
                        return true;
                    }
                }
            }
        }
    }
    $owned = count(allSources($S, $S['players'][$seat]));
    if (empty($R['config']['buying']) && ($a = $H('network')) !== null && $owned >= 4) {
        $p = $S['players'][$seat];
        $others = filt($p['hand'], static fn($u) => $u !== $a);
        $bon = (def($S, $R, $a)['bonus'] ?? 0) + bonus($S, $R, $seat, 'Letter');
        $ownedActions = [];
        foreach (array_merge($p['deck'], $p['hand'], $p['discard'], $p['play']) as $u) {
            if (kindOf($S, $u) === 'action') {
                $ownedActions[refOf($S, $u)] = true;
            }
        }
        $have = static function ($pl) use ($ownedActions) {
            foreach ($pl['tiers'] as $t) {
                if (isset($ownedActions[$t])) {
                    return true;
                }
            }
            return false;
        };
        $opts = v8sort(
            filt($R['piles'], static fn($pl) => !empty($S['market'][$pl['pile']]) && !$have($pl) && $pl['value'] <= count($others) + $bon),
            static fn($x, $y) => $y['value'] - $x['value']
        );
        foreach ($opts as $pl) {
            $k = $R['actions'][nextTier($S, $R, $pl['pile'])]['kind'];
            $need = max(1, $pl['value'] - $bon);
            $p = $S['players'][$seat];
            $both = array_merge($others, $p['discard']);
            $tgt = null;
            foreach ($both as $c) {
                if (kindOf($S, $c) === 'action' && refOf($S, $c) === $k) {
                    $tgt = $c;
                    break;
                }
            }
            if ($tgt === null && $k === 'draw') {
                foreach ([[$both, 'trash'], [$others, 'source'], [$p['discard'], 'source']] as [$list, $kind]) {
                    foreach ($list as $c) {
                        if (kindOf($S, $c) === $kind) {
                            $tgt = $c;
                            break 2;
                        }
                    }
                }
            }
            if ($tgt === null) {
                continue;
            }
            $pool = v8sort(
                filt($others, static fn($c) => $c !== $tgt),
                static fn($x, $y) => ((isSource($S, $x) ? 1 : 0) - (isSource($S, $y) ? 1 : 0)) ?: ((isTrash($S, $y) ? 1 : 0) - (isTrash($S, $x) ? 1 : 0))
            );
            $disc = in_array($tgt, $others, true) ? [$tgt] : [];
            while (count($disc) < $need && count($pool)) {
                $disc[] = array_shift($pool);
            }
            if (count($disc) < $need) {
                continue;
            }
            if (doNetwork($S, $R, $seat, $a, $disc, $pl['pile'], $tgt) === null) {
                return true;
            }
        }
    }
    if (!empty($R['config']['buying']) && $owned >= 4 && buysLeft($S, $R, $seat) > 0 && botBuy($S, $R, $seat)) {
        return true;
    }
    if (($a = $H('conference')) !== null) {
        $s = filt($srcs(), static fn($u) => !isFalseLead($S, $R, $u));
        if (count($s)) {
            $cnt = static function ($c) use ($S, $R, $seat) {
                $era = src($S, $R, $c)['era'];
                return count(filt(allSources($S, $S['players'][$seat]), static fn($x) => src($S, $R, $x)['era'] === $era));
            };
            $s = v8sort($s, static fn($x, $y) => $cnt($x) - $cnt($y));
            if (doConference($S, $R, $seat, $a, $s[0]) === null) {
                return true;
            }
        }
    }
    if (($a = $H('research')) !== null && $owned < 10) {
        $fixed = is_int(def($S, $R, $a)['take'] ?? null);
        $disc = $fixed ? [] : filt($S['players'][$seat]['hand'], static fn($u) => $u !== $a);
        if ($fixed || count($disc)) {
            $L = botArchive($S, $R, $seat);
            if ($L !== null && is_array(doResearch($S, $R, $seat, $a, $disc, $L, 'HistDeck\\botReject'))) {
                return true;
            }
        }
    }
    return false;
}

function botArchive(array &$S, array $R, int $seat): ?string
{
    $cnt = [];
    foreach ($R['letters'] as $L) {
        $cnt[$L] = 0;
    }
    foreach (allSources($S, $S['players'][$seat]) as $c) {
        $cnt[src($S, $R, $c)['arg']] += 2;
    }
    foreach ($S['players'][$seat]['shelf'] as $e) {
        $cnt[src($S, $R, $e['uid'])['arg']] += 3;
    }
    $Ls = v8sort(
        filt($R['letters'], static fn($L) => count($S['stacks'][$L]) > 0),
        static function ($x, $y) use (&$S, $cnt) {
            return ($cnt[$y] - $cnt[$x]) ?: ((count($S['stacks'][$y]) - count($S['stacks'][$x])) ?: (random($S) - 0.5));
        }
    );
    return $Ls[0] ?? null;
}

function botKeep(array $S, array $R): array
{
    $seat = $S['turn'];
    $p = $S['players'][$seat];
    $lim = keepLimit($S, $R, $seat);
    $own = allSources($S, $p);
    $out = [];
    $cnt = static function ($c) use ($S, $R, $p, $own) {
        $arg = src($S, $R, $c)['arg'];
        return count(filt($own, static fn($x) => src($S, $R, $x)['arg'] === $arg))
            + count(filt($p['shelf'], static fn($e) => in_array($arg, tagsOf($S, $R, $e['uid']), true)));
    };
    $find = static function (string $kind) use ($S, $R, $p) {
        foreach ($p['hand'] as $u) {
            if (kindOf($S, $u) === 'action' && def($S, $R, $u)['kind'] === $kind) {
                return $u;
            }
        }
        return null;
    };
    $bk = $find('book');
    if ($bk !== null && count($own) + count($p['shelf']) >= 4) {
        $out[] = $bk;
    }
    foreach (v8sort(filt($p['hand'], static fn($u) => isSource($S, $u)), static fn($x, $y) => $cnt($y) - $cnt($x)) as $c) {
        $out[] = $c;
    }
    $ar = $find('article');
    if ($ar !== null) {
        $out[] = $ar;
    }
    return array_slice($out, 0, $lim);
}

/**
 * Buying (current rules): the dearest upgrade the bot can pay for, from a pile it owns nothing from, paid with
 * the fewest cards: sources first, then action cards, the most powerful first.
 */
function botBuy(array &$S, array $R, int $seat): bool
{
    $p = $S['players'][$seat];
    $ownedActions = [];
    foreach (array_merge($p['deck'], $p['hand'], $p['discard'], $p['play']) as $u) {
        if (kindOf($S, $u) === 'action') {
            $ownedActions[refOf($S, $u)] = true;
        }
    }
    $pool = v8sort(
        filt($p['hand'], static fn($u) => powerOf($S, $R, $u) > 0),
        static fn($x, $y) => ((isSource($S, $y) ? 1 : 0) - (isSource($S, $x) ? 1 : 0)) ?: (powerOf($S, $R, $y) - powerOf($S, $R, $x))
    );
    if (!count($pool)) {
        return false;
    }
    $all = buyPower($S, $R, $seat, $pool);
    $opts = v8sort(
        filt($R['piles'], static function ($pl) use ($S, $ownedActions, $all) {
            if (!pileLeft($S, $pl['pile']) || $pl['value'] > $all) {
                return false;
            }
            foreach ($pl['tiers'] as $t) {
                if (isset($ownedActions[$t])) {
                    return false;
                }
            }
            return true;
        }),
        static fn($x, $y) => $y['value'] - $x['value']
    );
    foreach ($opts as $pl) {
        $disc = [];
        foreach ($pool as $u) {
            if (buyPower($S, $R, $seat, $disc) >= $pl['value']) {
                break;
            }
            $disc[] = $u;
        }
        if (doBuy($S, $R, $seat, $disc, $pl['pile']) === null) {
            return true;
        }
    }
    return false;
}
