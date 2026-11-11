<?php
// Port of engine/js/protocol.mjs: apply(), advanceBots(), toAct().
//
// Messages must be decoded with json_decode($json) (objects, not associative arrays), so that a JSON object
// and a JSON list stay distinguishable exactly as they are in JavaScript.
declare(strict_types=1);

namespace HistDeck;

const MAX_LIST = 100;
const UNDEF = "\0undefined";

function isId($x): bool
{
    return is_int($x) && $x > 0;
}

/** Length in UTF-16 code units, as JavaScript's String.length counts. */
function jsLength(string $s): int
{
    $chars = preg_split('//u', $s, -1, PREG_SPLIT_NO_EMPTY);
    if ($chars === false) {
        return PHP_INT_MAX;
    }
    $n = 0;
    foreach ($chars as $ch) {
        $n += strlen($ch) === 4 ? 2 : 1;
    }
    return $n;
}
function isName($x): bool
{
    return is_string($x) && $x !== '' && jsLength($x) <= 40;
}
function field(\stdClass $a, string $name)
{
    return property_exists($a, $name) ? $a->$name : UNDEF;
}

// Field checkers: each returns an error string or null.
function chkId(string $name): callable
{
    return static fn(\stdClass $a) => isId(field($a, $name)) ? null : "\"$name\" must be a card id.";
}
function chkOptId(string $name): callable
{
    return static function (\stdClass $a) use ($name) {
        $v = field($a, $name);
        return ($v === UNDEF || $v === null || isId($v)) ? null : "\"$name\" must be a card id.";
    };
}
function chkName(string $name): callable
{
    return static fn(\stdClass $a) => isName(field($a, $name)) ? null : "\"$name\" must be a name.";
}
function chkIds(string $name, bool $optional = false, ?int $len = null): callable
{
    return static function (\stdClass $a) use ($name, $optional, $len) {
        $v = field($a, $name);
        if ($v === UNDEF && $optional) {
            return null;
        }
        if (!is_array($v) || count($v) > MAX_LIST) {
            return "\"$name\" must be a list of card ids.";
        }
        foreach ($v as $x) {
            if (!isId($x)) {
                return "\"$name\" must be a list of card ids.";
            }
        }
        if (count(array_unique($v)) !== count($v)) {
            return "\"$name\" lists the same card twice.";
        }
        if ($len !== null && count($v) !== $len) {
            return "\"$name\" must list $len cards.";
        }
        return null;
    };
}
function opt(\stdClass $a, string $name, $default)
{
    $v = field($a, $name);
    return ($v === UNDEF || $v === null) ? $default : $v;
}

function messages(): array
{
    static $m = null;
    if ($m !== null) {
        return $m;
    }
    $m = [
        'draft' => [[chkName('stack')], static fn(&$S, $R, $seat, $a) => doDraft($S, $R, $a->stack)],
        'playDraw' => [[chkId('card')], static fn(&$S, $R, $seat, $a) => doDraw($S, $R, $seat, $a->card)],
        'organize' => [[chkId('card'), chkIds('trash')], static fn(&$S, $R, $seat, $a) => doOrganize($S, $R, $seat, $a->card, $a->trash)],
        'research' => [
            [chkId('card'), chkName('stack'), chkIds('discard', true)],
            static fn(&$S, $R, $seat, $a) => doResearch($S, $R, $seat, $a->card, opt($a, 'discard', []), $a->stack),
        ],
        'researchChoose' => [[chkIds('putBack')], static fn(&$S, $R, $seat, $a) => finishResearch($S, $R, $S['pending'], $a->putBack)],
        'conference' => [[chkId('card'), chkId('source')], static fn(&$S, $R, $seat, $a) => doConference($S, $R, $seat, $a->card, $a->source)],
        'article' => [
            [chkId('card'), chkIds('sources', false, 2), chkId('showcase')],
            static fn(&$S, $R, $seat, $a) => doArticle($S, $R, $seat, $a->card, $a->sources[0], $a->sources[1], $a->showcase),
        ],
        'book' => [
            [chkId('card'), chkIds('hand'), chkIds('shelf', true), chkOptId('showcase')],
            static fn(&$S, $R, $seat, $a) => doBook($S, $R, $seat, $a->card, $a->hand, opt($a, 'shelf', []), opt($a, 'showcase', null)),
        ],
        'network' => [
            [chkId('card'), chkIds('discard'), chkName('pile'), chkId('replace')],
            static fn(&$S, $R, $seat, $a) => doNetwork($S, $R, $seat, $a->card, $a->discard, $a->pile, $a->replace),
        ],
        'endTurn' => [[chkIds('keep', true)], static fn(&$S, $R, $seat, $a) => endTurn($S, $R, opt($a, 'keep', []))],
    ];
    return $m;
}

/** Checks everything except the rules themselves. Returns an error string or null. */
function checkAction(array $S, $seat, $action): ?string
{
    if (!($action instanceof \stdClass)) {
        return 'Bad message.';
    }
    $type = field($action, 'type');
    $m = is_string($type) ? (messages()[$type] ?? null) : null;
    if (!$m) {
        return 'Unknown action.';
    }
    if (!is_int($seat) || $seat < 0 || $seat >= count($S['players'])) {
        return 'You are not playing in this game.';
    }
    if ($S['over']) {
        return 'The game is over.';
    }
    if ($type === 'draft') {
        if ($S['phase'] !== 'draft') {
            return 'The draft is over.';
        }
        if ($seat !== $S['draftAt']) {
            return 'It is not your turn to choose a field.';
        }
    } else {
        if ($S['phase'] !== 'play') {
            return 'The draft is not finished.';
        }
        if ($S['pending']) {
            if ($seat !== $S['pending']['seat']) {
                return 'It is not your turn.';
            }
            if ($type !== 'researchChoose') {
                return 'Finish choosing which Research cards to put back first.';
            }
        } else {
            if ($seat !== $S['turn']) {
                return 'It is not your turn.';
            }
            if ($type === 'researchChoose') {
                return 'There is no Research choice to make.';
            }
        }
    }
    foreach ($m[0] as $check) {
        $e = $check($action);
        if ($e !== null) {
            return $e;
        }
    }
    return null;
}

/** Applies one message for one seat. Returns ['state' => ..., 'events' => [...]] or ['error' => string]. */
function apply(array $S, array $R, $seat, $action): array
{
    $bad = checkAction($S, $seat, $action);
    if ($bad !== null) {
        return ['error' => $bad];
    }
    $before = count($S['log']);
    $r = (messages()[$action->type][1])($S, $R, $seat, $action); // $S is this function's own copy
    if (is_string($r)) {
        return ['error' => $r];
    }
    return ['state' => $S, 'events' => array_slice($S['log'], $before)];
}

/** Who must act next: ['seat' => n, 'kind' => 'draft'|'research'|'turn'], or null when the game is over. */
function toAct(array $S): ?array
{
    if ($S['over']) {
        return null;
    }
    if ($S['phase'] === 'draft') {
        return ['seat' => $S['draftAt'], 'kind' => 'draft'];
    }
    if ($S['pending']) {
        return ['seat' => $S['pending']['seat'], 'kind' => 'research'];
    }
    return ['seat' => $S['turn'], 'kind' => 'turn'];
}

/** Plays bot seats until a human must act or the game ends. Returns ['state' => ..., 'events' => [...]]. */
function advanceBots(array $S, array $R, int $maxTurns = 10000): array
{
    $before = count($S['log']);
    for ($turns = 0; $turns < $maxTurns; $turns++) {
        $next = toAct($S);
        if (!$next || !$S['players'][$next['seat']]['bot'] || $next['kind'] === 'research') {
            break;
        }
        if ($next['kind'] === 'draft') {
            if (is_string(botDraft($S, $R))) {
                throw new \RuntimeException('A bot could not draft.');
            }
            continue;
        }
        $steps = 0;
        while (botStep($S, $R)) {
            if (++$steps > 500) {
                throw new \RuntimeException('A bot turn did not end.');
            }
        }
        endTurn($S, $R, botKeep($S, $R));
    }
    return ['state' => $S, 'events' => array_slice($S['log'], $before)];
}
