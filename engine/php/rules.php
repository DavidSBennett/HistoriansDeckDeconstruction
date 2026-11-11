<?php
// Port of engine/js/rules.mjs, plus loading the data/ files.
declare(strict_types=1);

namespace HistDeck;

/**
 * Reads data/config.json, actions.json, bonuses.json, trash.json, market.json and falseLeads.json (optional) and
 * decks/<deckId>/deck.json as associative arrays.
 */
function loadData(string $dataDir, string $deckId): array
{
    $read = static function (string $file): array {
        $text = file_get_contents($file);
        if ($text === false) {
            throw new \RuntimeException("Cannot read $file");
        }
        return json_decode($text, true, 512, JSON_THROW_ON_ERROR);
    };
    if (!preg_match('/^[a-z0-9-]+$/', $deckId)) {
        throw new \InvalidArgumentException('Bad deck id');
    }
    $market = "$dataDir/market.json";
    $falseLeads = "$dataDir/falseLeads.json";
    return [
        'config' => $read("$dataDir/config.json"),
        'actions' => $read("$dataDir/actions.json"),
        'bonuses' => $read("$dataDir/bonuses.json"),
        'trash' => $read("$dataDir/trash.json"),
        'market' => is_file($market) ? $read($market) : null,
        'falseLeads' => is_file($falseLeads) ? $read($falseLeads) : null,
        'deck' => $read("$dataDir/decks/$deckId/deck.json"),
    ];
}

/** The read-only rules array R that every engine function takes. Same fields as the JS makeRules(). */
function makeRules(array $data): array
{
    $config = $data['config'];
    $actions = $data['actions'];
    $market = $data['market'] ?? null;
    if ($market) {
        $piles = array_map(static fn($p) => ['pile' => $p['pile'], 'value' => $p['value'], 'tiers' => array_values($p['tiers'])], $market);
    } else {
        $piles = [];
        foreach ($actions as $k => $a) {
            if ($a['value'] > 0) {
                $piles[] = ['pile' => (string) $k, 'value' => $a['value'], 'tiers' => array_fill(0, $config['upgradeCopies'], (string) $k)];
            }
        }
    }
    $pileById = [];
    $pileOfTier = [];
    foreach ($piles as $p) {
        $pileById[$p['pile']] = $p;
        foreach ($p['tiers'] as $t) {
            $pileOfTier[$t] = $p['pile'];
        }
    }
    return [
        'config' => $config,
        'actions' => $actions,
        'bonuses' => $data['bonuses'],
        'trash' => $data['trash'],
        'deck' => $data['deck'],
        'theses' => $data['deck']['theses'],
        'cards' => $data['deck']['cards'],
        'letters' => array_map('strval', array_keys($data['deck']['theses'])),
        'piles' => $piles,
        'pileById' => $pileById,
        'pileOfTier' => $pileOfTier,
        'falseLeads' => $data['falseLeads'] ?? [],
        'base' => $config['startingActions'],
        'archiveWord' => $config['terms']['archive'] ?? 'card archive',
        'bookCardsTo' => $config['bookCardsTo'] ?? 'discard',
    ];
}
