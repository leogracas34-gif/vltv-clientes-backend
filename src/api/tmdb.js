import axios from 'axios';

// Busca filmes/séries no TMDB pra usar como base dos banners promocionais.
// A chave fica só aqui no backend - nunca dentro do APK, senão qualquer um
// que descompilar o app teria acesso a ela.
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_MINIATURA = 'https://image.tmdb.org/t/p/w154'; // rápido, pra lista de resultados
const TMDB_IMAGE_BANNER = 'https://image.tmdb.org/t/p/w780'; // qualidade boa pra compor o banner final

export async function buscarConteudo(termo) {
    if (!TMDB_API_KEY) {
        throw new Error('TMDB_API_KEY nao configurada no .env do backend.');
    }

    const resposta = await axios.get(`${TMDB_BASE_URL}/search/multi`, {
        params: {
            api_key: TMDB_API_KEY,
            query: termo,
            language: 'pt-BR',
            include_adult: false,
        },
        timeout: 10000,
    });

    // A busca "multi" do TMDB devolve filmes, series E pessoas (atores) no
    // mesmo resultado - filtramos só o que tem poster e e filme ou serie.
    return (resposta.data.results || [])
        .filter((item) => (item.media_type === 'movie' || item.media_type === 'tv') && item.poster_path)
        .slice(0, 10)
        .map((item) => ({
            id: item.id,
            tipo: item.media_type === 'movie' ? 'filme' : 'serie',
            titulo: item.title || item.name,
            ano: (item.release_date || item.first_air_date || '').substring(0, 4),
            sinopse: item.overview || '',
            thumbUrl: `${TMDB_IMAGE_MINIATURA}${item.poster_path}`,
            posterUrl: `${TMDB_IMAGE_BANNER}${item.poster_path}`,
        }));
}
