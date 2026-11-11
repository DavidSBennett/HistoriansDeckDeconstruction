<?php
// Replays games recorded by the JS engine (tools/record-conformance.mjs) and requires the PHP engine to
// produce the same state, events, errors and views after every op.
//   php engine/php/tests/conformance.php [build/conformance/games.json]
// On the first difference it stops, prints where, and writes the PHP state to build/conformance/php-state.json.
// Compare with the JS state: node tools/record-conformance.mjs --dump <game> <op>
declare(strict_types=1);

require __DIR__ . '/../engine_all.php';

use function HistDeck\{makeRules, newGame, apply, advanceBots, view, canonHash, canon};

ini_set('memory_limit', '1024M');
$root = dirname(__DIR__, 3);
$file = $argv[1] ?? "$root/build/conformance/games.json";
$text = @file_get_contents($file);
if ($text === false) {
    fwrite(STDERR, "No recording at $file. Run: node tools/record-conformance.mjs\n");
    exit(2);
}
$rec = json_decode($text, true, 512, JSON_THROW_ON_ERROR);
$rules = [];
foreach ($rec['rules'] as $name => $data) {
    $rules[$name] = makeRules($data);
}

function fail(string $game, int $i, array $op, string $what, $S, string $root): void
{
    fwrite(STDERR, "MISMATCH in game $game, op $i ({$op['op']}): $what\n");
    fwrite(STDERR, '  op: ' . json_encode($op, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n");
    if ($S !== null) {
        @mkdir("$root/build/conformance", 0777, true);
        file_put_contents("$root/build/conformance/php-state.json", json_encode($S, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        fwrite(STDERR, "  PHP state written to build/conformance/php-state.json; for the JS state run:\n");
        fwrite(STDERR, "  node tools/record-conformance.mjs --dump {$game} {$i}\n");
    }
    exit(1);
}

$t0 = microtime(true);
$counts = ['ops' => 0, 'views' => 0, 'errors' => 0];
foreach ($rec['games'] as $g) {
    $R = $rules[$g['rules']];
    $S = null;
    foreach ($g['ops'] as $i => $op) {
        $counts['ops']++;
        switch ($op['op']) {
            case 'newGame':
                $S = newGame($R, $g['seats'], $g['length'], $g['seed']);
                break;
            case 'advanceBots':
                $r = advanceBots($S, $R, $op['maxTurns'] ?? 10000);
                $S = $r['state'];
                if (canonHash($r['events']) !== $op['events']) {
                    fail($g['name'], $i, $op, 'events differ', $S, $root);
                }
                break;
            case 'apply':
                $msg = json_decode($op['msg'], false, 512, JSON_THROW_ON_ERROR);
                $before = canonHash($S);
                $r = apply($S, $R, $op['seat'], $msg);
                if (isset($op['error'])) {
                    $counts['errors']++;
                    if (!isset($r['error'])) {
                        fail($g['name'], $i, $op, 'PHP accepted a message JS refused', $r['state'], $root);
                    }
                    if ($r['error'] !== $op['error']) {
                        fail($g['name'], $i, $op, "error text differs: PHP said \"{$r['error']}\"", $S, $root);
                    }
                    if (canonHash($S) !== $before) {
                        fail($g['name'], $i, $op, 'a refused message changed the state', $S, $root);
                    }
                    continue 2;
                }
                if (isset($r['error'])) {
                    fail($g['name'], $i, $op, "PHP refused a message JS accepted: \"{$r['error']}\"", $S, $root);
                }
                $S = $r['state'];
                if (canonHash($r['events']) !== $op['events']) {
                    fail($g['name'], $i, $op, 'events differ', $S, $root);
                }
                break;
            case 'view':
                $counts['views']++;
                if (canonHash(view($S, $R, $op['seat'])) !== $op['hash']) {
                    fail($g['name'], $i, $op, 'view differs for seat ' . var_export($op['seat'], true), $S, $root);
                }
                continue 2;
            default:
                fail($g['name'], $i, $op, 'unknown op', null, $root);
        }
        if (canonHash($S) !== $op['hash']) {
            fail($g['name'], $i, $op, 'state differs', $S, $root);
        }
    }
    if (canon($S) !== canon($g['final'])) {
        fail($g['name'], count($g['ops']) - 1, ['op' => 'final'], 'final state differs', $S, $root);
    }
}
printf(
    "PHP %s matches the JS engine: %d games, %d ops (%d views, %d refused messages) in %.1f s\n",
    PHP_VERSION, count($rec['games']), $counts['ops'], $counts['views'], $counts['errors'], microtime(true) - $t0
);
