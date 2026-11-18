<?php
/**
 * testes/http.php - um cliente HTTP minimo para os testes de fluxo: guarda
 * os cookies (sessao do painel e do app), manda JSON com Origin do proprio
 * servidor (a API recusa mutacao sem isso) e devolve [codigo, json].
 */

declare(strict_types=1);

final class Cliente
{
    private array $cookies = [];

    public function __construct(private string $base)
    {
        $this->base = rtrim($base, '/');
    }

    /** @return array{0:int,1:array} */
    public function pedir(string $metodo, string $caminho, ?array $corpo = null): array
    {
        $ch = curl_init($this->base . $caminho);
        $cabecalhos = ['Origin: ' . $this->base, 'Accept: application/json'];
        if ($corpo !== null) {
            $cabecalhos[] = 'Content-Type: application/json';
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($corpo, JSON_UNESCAPED_UNICODE));
        } elseif (in_array($metodo, ['POST', 'PUT', 'DELETE'], true)) {
            $cabecalhos[] = 'Content-Type: application/json';
        }
        if ($this->cookies) {
            $cabecalhos[] = 'Cookie: ' . implode('; ', array_map(fn ($k, $v) => $k . '=' . $v, array_keys($this->cookies), $this->cookies));
        }
        curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $metodo, CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true,
                                CURLOPT_HTTPHEADER => $cabecalhos, CURLOPT_TIMEOUT => 30]);
        $resposta = curl_exec($ch);
        if ($resposta === false) {
            throw new RuntimeException('HTTP falhou: ' . curl_error($ch));
        }
        $codigo = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $tamanho = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
        curl_close($ch);
        $cabecalho = substr($resposta, 0, $tamanho);
        foreach (explode("\r\n", $cabecalho) as $linha) {
            if (stripos($linha, 'Set-Cookie:') === 0 && preg_match('/^Set-Cookie:\s*([^=]+)=([^;]*)/i', $linha, $m)) {
                if ($m[2] === '' || stripos($linha, 'expires=Thu, 01 Jan 1970') !== false || preg_match('/max-age=0/i', $linha)) {
                    unset($this->cookies[$m[1]]);
                } else {
                    $this->cookies[$m[1]] = $m[2];
                }
            }
        }
        $json = json_decode(substr($resposta, $tamanho), true);
        return [$codigo, is_array($json) ? $json : ['_bruto' => substr($resposta, $tamanho)]];
    }

    public function get(string $c): array { return $this->pedir('GET', $c); }
    public function post(string $c, array $corpo = []): array { return $this->pedir('POST', $c, $corpo); }
    public function put(string $c, array $corpo = []): array { return $this->pedir('PUT', $c, $corpo); }
    public function delete(string $c): array { return $this->pedir('DELETE', $c); }

    /** Pede e exige o codigo esperado; devolve o JSON. */
    public function ok(string $metodo, string $caminho, ?array $corpo = null, int $esperado = 0): array
    {
        [$codigo, $json] = $this->pedir($metodo, $caminho, $corpo);
        $bom = $esperado ? $codigo === $esperado : $codigo >= 200 && $codigo < 300;
        if (!$bom) {
            throw new RuntimeException("{$metodo} {$caminho}: esperado " . ($esperado ?: '2xx') . ", veio {$codigo}: "
                . ($json['erro'] ?? json_encode($json, JSON_UNESCAPED_UNICODE)));
        }
        return $json;
    }

    /** Pede e exige um ERRO com este codigo; devolve a mensagem. */
    public function erro(string $metodo, string $caminho, ?array $corpo, int $esperado): string
    {
        [$codigo, $json] = $this->pedir($metodo, $caminho, $corpo);
        if ($codigo !== $esperado) {
            throw new RuntimeException("{$metodo} {$caminho}: esperado erro {$esperado}, veio {$codigo}: " . json_encode($json, JSON_UNESCAPED_UNICODE));
        }
        return (string) ($json['erro'] ?? '');
    }
}
