import { showContentSafetyAlert } from '@/features/safety/showContentSafetyAlert';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { ScreenHeader } from '@/features/profile/components/ScreenHeader';
import { useProfileStore } from '@/features/profile/store/ProfileStore';
import type { EditableProfile } from '@/features/profile/types/profile';
import { colors, fontFamily, fontSize, radii, shadows, spacing } from '@/theme';
import { StatePicker } from '@/features/location/components/StatePicker';
import {
  isValidCity, isValidPostalCode, isValidState, normalizeCity,
} from '@/features/location/locationValidation';
import { normalizeSelectedPhoto } from '@/features/sell/services/photoNormalizer';
import type { ListingDraftPhoto } from '@/features/sell/types/listingDraft';
import {
  removeProfileAvatar,
  uploadProfileAvatar,
} from '@/features/profile/services/profileAvatarRepository';

type Errors = Partial<Record<keyof EditableProfile, string>>;

export function EditProfileScreen() {
  const router = useRouter();
  const { profile, updateProfile } = useProfileStore();
  const [form, setForm] = useState<EditableProfile>({
    displayName: profile.displayName,
    username: profile.username,
    bio: profile.bio,
    city: profile.city,
    state: profile.state,
    postalCode: profile.postalCode,
    photoUri: profile.photoUri,
  });
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingPhoto, setPendingPhoto] = useState<ListingDraftPhoto | null>(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);

  const update = (key: keyof EditableProfile, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const pickPhoto = async () => {
    if (Platform.OS !== 'ios') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Photo Access Needed', 'Allow photo library access to choose a profile picture.');
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    try {
      const photo = await normalizeSelectedPhoto({
        id: asset.assetId ?? asset.uri,
        uri: asset.uri,
        fileName: asset.fileName,
        fileSize: asset.fileSize,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
      }, 0);
      setPendingPhoto(photo);
      setPhotoRemoved(false);
      setServerError(null);
    } catch (cause) {
      Alert.alert(
        'Profile picture unavailable',
        cause instanceof Error ? cause.message : 'Choose another image and try again.',
      );
    }
  };

  const save = async () => {
    if (saving) return;
    const next: Errors = {};
    if (form.displayName.trim().length < 2) next.displayName = 'Enter your display name.';
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(form.username.trim())) next.username = 'Use 3–20 letters, numbers, or underscores.';
    if (form.city || form.state || form.postalCode) {
      if (!isValidCity(form.city)) next.city = 'Enter a valid city name.';
      if (!isValidState(form.state)) next.state = 'Select a valid US state.';
      if (!isValidPostalCode(form.postalCode)) next.postalCode = 'Use a 5-digit ZIP code or ZIP+4.';
    }
    if (form.bio.length > 240) next.bio = 'Keep your bio under 240 characters.';
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }
    setSaving(true);
    setServerError(null);
    try {
      let photoUri = form.photoUri;
      if (pendingPhoto) photoUri = await uploadProfileAvatar(pendingPhoto);
      else if (photoRemoved) {
        await removeProfileAvatar();
        photoUri = undefined;
      }
      const result = await updateProfile({
        ...form,
        displayName: form.displayName.trim(),
        username: form.username.trim().toLowerCase(),
        bio: form.bio.trim(),
        city: normalizeCity(form.city),
        state: form.state.trim().toUpperCase(),
        postalCode: form.postalCode.trim().toUpperCase(),
        photoUri,
      });
      if (result.error) {
        showContentSafetyAlert({ message: result.error });
        setServerError(result.error);
        return;
      }
      Alert.alert('Profile updated', 'Your changes have been saved.', [
        { text: 'Done', onPress: () => router.back() },
      ]);
    } catch (cause) {
      setServerError(cause instanceof Error ? cause.message : 'Your profile picture could not be updated.');
    } finally {
      setSaving(false);
    }
  };

  const displayedPhoto = pendingPhoto?.uri ?? (photoRemoved ? undefined : form.photoUri);

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboard}>
        <ScreenHeader
          right={<Pressable hitSlop={8} onPress={save}><Text style={styles.headerSave}>Save</Text></Pressable>}
          title="Edit Profile"
        />
        <ScrollView contentContainerStyle={styles.content} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
          <View style={[styles.card, styles.photoCard]}>
            {displayedPhoto ? <Image contentFit="cover" source={displayedPhoto} style={styles.photo} /> : <Avatar initials={profile.initials} size={84} />}
            <View style={styles.photoActions}>
              <Pressable disabled={saving} onPress={() => void pickPhoto()} style={styles.photoButton}>
                <Text style={styles.photoButtonText}>{displayedPhoto ? 'Change Photo' : 'Add Photo'}</Text>
              </Pressable>
              {displayedPhoto ? (
                <Pressable disabled={saving} onPress={() => { setPendingPhoto(null); setPhotoRemoved(true); }} style={styles.photoButton}>
                  <Text style={styles.removePhotoText}>Remove Photo</Text>
                </Pressable>
              ) : null}
            </View>
            <Field
              autoCapitalize="characters"
              error={errors.postalCode}
              label="Postal code (optional)"
              keyboardType="number-pad"
              maxLength={10}
              onChangeText={(value) => update('postalCode', value.replace(/[^\d-]/g, ''))}
              value={form.postalCode}
            />
          </View>
          <View style={styles.card}>
            <Field error={errors.displayName} label="Display name" onChangeText={(value) => update('displayName', value)} value={form.displayName} />
            <Field autoCapitalize="none" error={errors.username} label="Username" onChangeText={(value) => update('username', value.replace(/\s/g, ''))} prefix="@" value={form.username} />
            <Field error={errors.bio} label="Bio" multiline onChangeText={(value) => update('bio', value)} value={form.bio} />
            <View style={styles.locationRow}>
              <View style={styles.city}><Field error={errors.city} label="City" onBlur={() => update('city', normalizeCity(form.city))} onChangeText={(value) => update('city', value)} value={form.city} /></View>
              <View style={styles.state}>
                <Text style={styles.label}>State</Text>
                <StatePicker error={errors.state} onChange={(value) => update('state', value)} value={form.state} />
              </View>
            </View>
          </View>
          {serverError ? <Text style={styles.serverError}>{serverError}</Text> : null}
          <Pressable disabled={saving} onPress={save} style={[styles.saveButton, saving && styles.saving]}><Text style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save Changes'}</Text></Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ error, label, prefix, ...props }: React.ComponentProps<typeof TextInput> & { error?: string; label: string; prefix?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputWrap, error && styles.errorBorder]}>
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput placeholderTextColor={colors.textSecondary} style={[styles.input, props.multiline && styles.multiline]} {...props} />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surface, flex: 1 },
  keyboard: { flex: 1 },
  headerSave: { color: colors.primary, fontFamily: fontFamily.bold, fontSize: fontSize.body },
  content: { backgroundColor: colors.background, padding: spacing.lg, paddingBottom: spacing.xxxl },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, marginBottom: spacing.md, padding: spacing.lg, ...shadows.card },
  photoCard: { alignItems: 'center' },
  photo: { borderRadius: radii.round, height: 84, width: 84 },
  photoActions: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg, marginTop: spacing.md },
  photoButton: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  photoButtonText: { color: colors.primary, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
  removePhotoText: { color: colors.textSecondary, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall },
  field: { marginBottom: spacing.lg },
  label: { color: colors.text, fontFamily: fontFamily.semibold, fontSize: fontSize.bodySmall, marginBottom: 6 },
  inputWrap: { alignItems: 'center', backgroundColor: colors.background, borderColor: 'transparent', borderRadius: radii.md, borderWidth: 1, flexDirection: 'row' },
  errorBorder: { borderColor: colors.primary },
  prefix: { color: colors.textSecondary, fontFamily: fontFamily.medium, fontSize: fontSize.body, paddingLeft: spacing.md },
  input: { color: colors.text, flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.body, minHeight: 48, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  error: { color: colors.primary, fontFamily: fontFamily.medium, fontSize: fontSize.footnote, marginTop: 5 },
  locationRow: { flexDirection: 'row', gap: spacing.md },
  city: { flex: 2 },
  state: { flex: 1 },
  saveButton: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 14, justifyContent: 'center', minHeight: 52 },
  saveButtonText: { color: colors.white, fontFamily: fontFamily.bold, fontSize: fontSize.body },
  serverError: { color: colors.primary, fontFamily: fontFamily.medium, fontSize: fontSize.bodySmall, lineHeight: 19, marginBottom: spacing.md },
  saving: { opacity: 0.65 },
});
