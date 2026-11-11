<?php
/**
 * db.php — a thin PDO wrapper that runs the same queries on MySQL (the server) and SQLite (local tests and
 * CI, where there is no MySQL). Only the few things the two dialects spell differently go through it:
 * the current time, time arithmetic, row locks and starting a write transaction.
 */
declare(strict_types=1);

final class DkDb
{
    public PDO $pdo;
    public bool $sqlite;

    public function __construct(string $dsn, ?string $user = null, ?string $pass = null)
    {
        $this->pdo = new PDO($dsn, $user, $pass, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        $this->sqlite = $this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite';
        if ($this->sqlite) {
            $this->pdo->exec('PRAGMA foreign_keys = ON');
            $this->pdo->exec('PRAGMA busy_timeout = 5000');
        }
    }

    /** SQL for "now", in the database's own clock (as Board's tables use). */
    public function now(): string
    {
        return $this->sqlite ? "datetime('now')" : 'NOW()';
    }

    /** SQL for now plus a whole number of days or minutes. */
    public function plus(int $n, string $unit): string
    {
        if (!in_array($unit, ['DAY', 'MINUTE'], true)) {
            throw new InvalidArgumentException('unit');
        }
        return $this->sqlite
            ? "datetime('now', '+$n " . strtolower($unit) . "s')"
            : "DATE_ADD(NOW(), INTERVAL $n $unit)";
    }

    /** Appended to a SELECT that must lock its rows until commit. SQLite locks the whole file instead. */
    public function forUpdate(): string
    {
        return $this->sqlite ? '' : ' FOR UPDATE';
    }

    public function begin(): void
    {
        if ($this->sqlite) {
            $this->pdo->exec('BEGIN IMMEDIATE');
        } else {
            $this->pdo->beginTransaction();
        }
    }

    public function commit(): void
    {
        $this->sqlite ? $this->pdo->exec('COMMIT') : $this->pdo->commit();
    }

    public function rollback(): void
    {
        try {
            $this->sqlite ? $this->pdo->exec('ROLLBACK') : $this->pdo->rollBack();
        } catch (Throwable $e) {
            // nothing open
        }
    }

    public function run(string $sql, array $params = []): PDOStatement
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($params);
        return $st;
    }

    public function one(string $sql, array $params = []): ?array
    {
        $row = $this->run($sql, $params)->fetch();
        return $row === false ? null : $row;
    }

    public function all(string $sql, array $params = []): array
    {
        return $this->run($sql, $params)->fetchAll();
    }

    public function lastId(): int
    {
        return (int) $this->pdo->lastInsertId();
    }
}
