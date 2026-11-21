<?php
// Test harness only. The Baikal release and all data live outside the repository.
$release = getenv('FRIGG_BAIKAL_RELEASE');
$data = getenv('FRIGG_BAIKAL_DATA');
if (!$release || !$data || !str_contains($data, 'frigg-baikal-run-')) {
    http_response_code(500); exit('isolated test directory required');
}
if ($_SERVER['REQUEST_URI'] === '/healthz') { echo 'ok'; return; }
if (str_starts_with($_SERVER['REQUEST_URI'], '/.well-known/')) {
    header('Location: /dav.php/', true, 301); return;
}
require $release . '/vendor/autoload.php';
define('PROJECT_PATH_CONFIG', $data . '/');
$pdo = new PDO('sqlite:' . $data . '/db.sqlite');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
if (!file_exists($data . '/initialized')) {
    $pdo->exec(file_get_contents($release . '/Core/Resources/Db/SQLite/db.sql'));
    $stmt = $pdo->prepare('INSERT INTO users(username,digesta1) VALUES (?,?)');
    $stmt->execute(['synthetic', md5('synthetic:FriggTest:synthetic-only')]);
    $pdo->exec("INSERT INTO principals(uri,email,displayname) VALUES ('principals/synthetic','synthetic@example.invalid','Synthetic');");
    $pdo->exec("INSERT INTO addressbooks(principaluri,uri,displayname) VALUES ('principals/synthetic','a','A'),('principals/synthetic','b','B');");
    file_put_contents($data . '/baikal.yaml', "system: {}\n");
    file_put_contents($data . '/initialized', 'yes');
}
$server = new \Baikal\Core\Server(false, true, 'Basic', 'FriggTest', $pdo, '/dav.php/');
$server->start();
