import { AniList } from '../providers/anilist.js';
import { AnimeKai } from '../providers/animekai.js';

export async function mapAnilistToAnimeKai(anilistId) {
  const mapper = new AnimeKaiMapper();
  return await mapper.mapAnilistToAnimeKai(anilistId);
}

export class AnimeKaiMapper {
  constructor() {
    this.anilist = new AniList();
    this.animeKai = new AnimeKai();
  }
  async mapAnilistToAnimeKai(anilistId) {
    try {
      const animeInfo = await this.anilist.getAnimeInfo(parseInt(anilistId));

      if (!animeInfo) {
        throw new Error(`Anime with id ${anilistId} not found on AniList`);
      }
      const searchTitle = animeInfo.title.english || animeInfo.title.romaji || animeInfo.title.userPreferred;
      if (!searchTitle) {
        throw new Error('No title available for the anime');
      }
      const searchResults = await this.animeKai.search(searchTitle);
      if (!searchResults || !searchResults.results || searchResults.results.length === 0) {
        return {
          id: animeInfo.id,
          title: searchTitle,
          animekai: null
        };
      }
      const bestMatch = this.findBestMatch(searchTitle, animeInfo, searchResults.results);
      if (!bestMatch) {
        return {
          id: animeInfo.id,
          title: searchTitle,
          animekai: null
        };
      }
      const animeDetails = await this.animeKai.fetchAnimeInfo(bestMatch.id);

      return {
        id: animeInfo.id,
        title: searchTitle,
        animekai: {
          id: bestMatch.id,
          title: bestMatch.title,
          japaneseTitle: bestMatch.japaneseTitle,
          url: bestMatch.url,
          image: bestMatch.image,
          type: bestMatch.type,
          episodes: animeDetails.totalEpisodes,
          episodesList: animeDetails.episodes,
          hasSub: animeDetails.hasSub,
          hasDub: animeDetails.hasDub,
          subOrDub: animeDetails.subOrDub,
          status: animeDetails.status,
          season: animeDetails.season,
          genres: animeDetails.genres
        }
      };
    } catch (error) {
      console.error('Error mapping AniList to AnimeKai:', error);
      throw error;
    }
  }
  findBestMatch(searchTitle, animeInfo, results) {
    if (!results || results.length === 0) return null;
    const normalizeTitle = title => title.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    const normalizedSearch = normalizeTitle(searchTitle);
    let year = null;
    if (animeInfo.startDate && animeInfo.startDate.year) {
      year = animeInfo.startDate.year;
    } else if (animeInfo.seasonYear) {
      year = animeInfo.seasonYear;
    }
    for (const result of results) {
      const resultTitle = normalizeTitle(result.title);
      const japaneseTitle = result.japaneseTitle ? normalizeTitle(result.japaneseTitle) : '';

      if (resultTitle === normalizedSearch || japaneseTitle === normalizedSearch) {
        return result;
      }
    }
    const expectedEpisodes = animeInfo.episodes || 0;
    for (const result of results) {
      const resultTitle = normalizeTitle(result.title);
      const japaneseTitle = result.japaneseTitle ? normalizeTitle(result.japaneseTitle) : '';
      if (result.episodes === expectedEpisodes && expectedEpisodes > 0) {
        if (resultTitle.includes(normalizedSearch) ||
          normalizedSearch.includes(resultTitle) ||
          japaneseTitle.includes(normalizedSearch) ||
          normalizedSearch.includes(japaneseTitle)) {
          return result;
        }
      }
    }
    return results[0];
  }
}

export default mapAnilistToAnimeKai; 