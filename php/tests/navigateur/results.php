<?php
// Reçoit les résultats des tests (JSON) et les écrit à côté, dans resultats.json.
file_put_contents(__DIR__ . '/resultats.json', file_get_contents('php://input'));
echo 'ok';
