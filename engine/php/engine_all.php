<?php
// Loads the whole PHP engine. The backend requires this one file.
// Needs PHP 8.1 or later (array_is_list, spread of string-keyed arrays).
declare(strict_types=1);

require_once __DIR__ . '/rng.php';
require_once __DIR__ . '/rules.php';
require_once __DIR__ . '/engine.php';
require_once __DIR__ . '/bots.php';
require_once __DIR__ . '/protocol.php';
require_once __DIR__ . '/view.php';
require_once __DIR__ . '/canon.php';
