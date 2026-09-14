package link.latr

import android.app.Application
import android.content.Context
import androidx.room.*
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

@Entity(tableName = "bookmarks", primaryKeys = ["did", "uri"])
data class CachedBookmark(val did: String, val uri: String, val json: String)
@Entity(tableName = "pending", indices = [Index(value = ["did", "subject"], unique = true)])
data class PendingSave(@PrimaryKey val id: String, val did: String, val subject: String, val tags: String, val createdAt: Long, val error: String? = null)
@Dao interface LibraryDao {
    @Query("SELECT * FROM bookmarks WHERE did = :did") suspend fun bookmarks(did: String): List<CachedBookmark>
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun cache(rows: List<CachedBookmark>)
    @Query("DELETE FROM bookmarks WHERE did = :did") suspend fun clearCache(did: String)
    @Query("DELETE FROM bookmarks WHERE did = :did AND uri = :uri") suspend fun remove(did: String, uri: String)
    @Query("SELECT * FROM pending WHERE did = :did ORDER BY createdAt") suspend fun pending(did: String): List<PendingSave>
    @Query("SELECT * FROM pending WHERE did = :did AND subject = :subject LIMIT 1") suspend fun pendingSubject(did: String, subject: String): PendingSave?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun enqueue(row: PendingSave)
    @Update suspend fun update(row: PendingSave)
    @Query("DELETE FROM pending WHERE id = :id AND did = :did") suspend fun discard(id: String, did: String)
    @Query("UPDATE pending SET error = :error WHERE id = :id") suspend fun pendingError(id: String, error: String?)
    @Transaction suspend fun replaceCache(did: String, rows: List<CachedBookmark>) { clearCache(did); cache(rows) }
}
@Database(entities = [CachedBookmark::class, PendingSave::class], version = 1, exportSchema = true)
abstract class LibraryDatabase : RoomDatabase() { abstract fun library(): LibraryDao }
private val Context.preferences by preferencesDataStore("appearance")
data class Appearance(val theme: String = "System", val font: String = "Sans", val bold: Boolean = false)
class Settings(private val context: Context) {
    val appearance: Flow<Appearance> = context.preferences.data.map { Appearance(it[stringPreferencesKey("theme")] ?: "System", it[stringPreferencesKey("font")] ?: "Sans", it[booleanPreferencesKey("bold")] ?: false) }
    suspend fun set(value: Appearance) { context.preferences.edit { it[stringPreferencesKey("theme")] = value.theme; it[stringPreferencesKey("font")] = value.font; it[booleanPreferencesKey("bold")] = value.bold } }
}
class LatrApplication : Application() {
    val database by lazy { Room.databaseBuilder(this, LibraryDatabase::class.java, "library.db").build() }
    val auth by lazy { OAuthClient(this) }
    val repository by lazy { LibraryRepository(auth, database.library()) }
    val settings by lazy { Settings(this) }
}
