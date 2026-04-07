import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { router } from 'expo-router';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ListRenderItemInfo,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';

import { GlassCard } from '@/src/components/ui/glass-card';
import { LiquidBackground } from '@/src/components/ui/liquid-background';
import { useAuth } from '@/src/providers/auth-provider';
import { useApp } from '@/src/providers/app-provider';
import {
  useSocial,
  type SocialFriend,
  type SocialFriendRequest,
  type SocialRoomInvite,
} from '@/src/providers/social-provider';

function statusColor(status: 'online' | 'offline' | 'away') {
  if (status === 'online') return '#10B981';
  if (status === 'away') return '#F59E0B';
  return '#6B7280';
}

function FriendItem({
  item,
  onOpenProfile,
  onOpenChat,
}: {
  item: SocialFriend;
  onOpenProfile: () => void;
  onOpenChat: () => void;
}) {
  const { theme } = useApp();

  return (
    <Pressable onPress={onOpenChat}>
      <GlassCard style={styles.friendCard}>
        <View style={styles.friendRow}>
          <Pressable onPress={onOpenProfile} style={styles.avatarContainer}>
            <View style={[styles.avatar, { backgroundColor: theme.surfaceStrong }]}>
              <Text style={[styles.avatarText, { color: theme.textPrimary }]}>{item.name.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={[styles.statusIndicator, { backgroundColor: statusColor(item.status) }]} />
          </Pressable>

          <View style={styles.friendInfo}>
             <Text style={[styles.friendName, { color: theme.textPrimary }]}>{item.name}</Text>
             <Text style={[styles.friendHandle, { color: theme.textSecondary }]}>{item.handle}</Text>
          </View>

          <Ionicons name="chatbubble-outline" size={20} color={theme.accentPrimary} />
        </View>
      </GlassCard>
    </Pressable>
  );
}

export default function SocialTabScreen() {
  const { t } = useTranslation();
  const { theme } = useApp();
  const { user } = useAuth();
  const {
    ready,
    friends,
    incomingRequests,
    addFriend,
    acceptFriendRequest,
    declineFriendRequest,
    getOrCreateChat,
    refreshSocial,
  } = useSocial();

  const [modalVisible, setModalVisible] = useState(false);
  const [friendQuery, setFriendQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddFriend = async () => {
    setLoading(true);
    setError(null);
    try {
      await addFriend(friendQuery);
      setFriendQuery('');
      setModalVisible(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!ready) {
    return (
      <LiquidBackground>
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={theme.accentPrimary} />
        </View>
      </LiquidBackground>
    );
  }

  return (
    <LiquidBackground>
      <View style={styles.screen}>
        <FlatList
          data={friends}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <FriendItem
              item={item}
              onOpenProfile={() => router.push({ pathname: '/user/[userId]', params: { userId: item.userId } })}
              onOpenChat={async () => {
                 const chat = await getOrCreateChat(item.userId);
                 router.push({ pathname: '/chat/[chatId]', params: { chatId: chat.id } });
              }}
            />
          )}
          ListHeaderComponent={
            <View style={styles.header}>
              <View style={styles.headerTop}>
                <View>
                  <Text style={[styles.eyebrow, { color: theme.textMuted }]}>{t('social.eyebrow')}</Text>
                  <Text style={[styles.title, { color: theme.textPrimary }]}>{t('social.title')}</Text>
                </View>
                <View style={styles.headerActions}>
                  <Pressable onPress={() => router.push('/profile')} style={[styles.headerButton, { backgroundColor: theme.surfaceStrong }]}>
                    <Ionicons name="person-outline" size={20} color={theme.textPrimary} />
                  </Pressable>
                  <Pressable onPress={() => setModalVisible(true)} style={[styles.headerButton, { backgroundColor: theme.accentPrimary }]}>
                    <Ionicons name="person-add-outline" size={20} color="#000" />
                  </Pressable>
                </View>
              </View>

              {incomingRequests.length > 0 && (
                <View style={styles.requestsSection}>
                   <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>{t('social.incomingRequests')}</Text>
                   {incomingRequests.map(req => (
                     <GlassCard key={req.id} style={styles.requestCard}>
                        <Text style={[styles.requestText, { color: theme.textPrimary }]}>{req.user.name}</Text>
                        <View style={styles.requestActions}>
                           <Pressable onPress={() => declineFriendRequest(req.id)} style={styles.requestBtn}>
                              <Ionicons name="close" size={20} color={theme.danger} />
                           </Pressable>
                           <Pressable onPress={() => acceptFriendRequest(req.id)} style={[styles.requestBtn, { backgroundColor: theme.accentPrimary }]}>
                              <Ionicons name="checkmark" size={20} color="#000" />
                           </Pressable>
                        </View>
                     </GlassCard>
                   ))}
                </View>
              )}

              <Text style={[styles.sectionTitle, { color: theme.textPrimary, marginTop: 24 }]}>{t('social.friendsTitle')}</Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
               <Ionicons name="people-outline" size={64} color={theme.textMuted} />
               <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>{t('social.emptyTitle')}</Text>
            </View>
          }
        />
      </View>

      <Modal animationType="fade" transparent visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalBackdrop}>
           <GlassCard style={styles.modalCard}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>{t('social.addFriendTitle')}</Text>
              <TextInput
                value={friendQuery}
                onChangeText={setFriendQuery}
                placeholder={t('social.searchPlaceholder')}
                placeholderTextColor={theme.textMuted}
                style={[styles.input, { color: theme.textPrimary, borderColor: theme.cardBorder, backgroundColor: theme.inputBackground }]}
                autoCapitalize="none"
              />
              {error && <Text style={{ color: theme.danger, fontSize: 12 }}>{error}</Text>}
              <View style={styles.modalActions}>
                 <Pressable onPress={() => setModalVisible(false)} style={styles.modalButton}>
                    <Text style={{ color: theme.textSecondary }}>{t('common.cancel')}</Text>
                 </Pressable>
                 <Pressable onPress={handleAddFriend} disabled={loading} style={[styles.modalButton, { backgroundColor: theme.accentPrimary }]}>
                    <Text style={{ color: '#000', fontWeight: '800' }}>{t('common.create')}</Text>
                 </Pressable>
              </View>
           </GlassCard>
        </View>
      </Modal>
    </LiquidBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  listContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 100 },
  header: { marginBottom: 12 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  eyebrow: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  title: { fontSize: 32, fontWeight: '900', marginTop: 4 },
  headerActions: { flexDirection: 'row', gap: 10 },
  headerButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 18, fontWeight: '800', marginBottom: 12 },
  friendCard: { padding: 12, marginBottom: 10 },
  friendRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarContainer: { position: 'relative' },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 20, fontWeight: '900' },
  statusIndicator: { position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#000' },
  friendInfo: { flex: 1, gap: 2 },
  friendName: { fontSize: 16, fontWeight: '800' },
  friendHandle: { fontSize: 12, fontWeight: '600' },
  requestsSection: { gap: 10 },
  requestCard: { padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  requestText: { fontSize: 15, fontWeight: '700' },
  requestActions: { flexDirection: 'row', gap: 8 },
  requestBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
  emptyState: { alignItems: 'center', justifyContent: 'center', marginTop: 100, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '800' },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', padding: 20, gap: 16 },
  modalTitle: { fontSize: 20, fontWeight: '900' },
  input: { minHeight: 50, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, fontSize: 15 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  modalButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
});
