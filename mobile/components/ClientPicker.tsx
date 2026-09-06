import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Modal } from 'react-native';

interface Trader {
  id: string;
  name?: string;
  business_name?: string;
  gstin?: string;
}

interface ClientPickerProps {
  traders: Trader[];
  activeTraderId: string | null;
  onSelect: (traderId: string) => void;
}

export default function ClientPicker({ traders, activeTraderId, onSelect }: ClientPickerProps) {
  const [open, setOpen] = useState(false);

  const activeTrader = traders.find(t => t.id === activeTraderId) || traders[0];

  if (!traders || traders.length === 0) return null;

  return (
    <>
      <Pressable style={styles.button} onPress={() => setOpen(true)}>
        <Text style={styles.buttonText} numberOfLines={1}>
          {activeTrader?.name || activeTrader?.business_name || 'Select Client'} ▾
        </Text>
      </Pressable>

      <Modal visible={open} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.header}>
              <Text style={styles.headerText}>Switch Client</Text>
              <Pressable onPress={() => setOpen(false)}>
                <Text style={styles.closeText}>Done</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.list}>
              {traders.map(t => (
                <Pressable
                  key={t.id}
                  style={[styles.item, activeTraderId === t.id && styles.itemActive]}
                  onPress={() => {
                    onSelect(t.id);
                    setOpen(false);
                  }}
                >
                  <Text style={[styles.itemTitle, activeTraderId === t.id && styles.itemTitleActive]}>
                    {t.name || t.business_name || t.id.slice(0, 8)}
                  </Text>
                  <Text style={styles.itemSubtitle}>
                    {t.gstin ? t.gstin.slice(0, 10) : 'Setup Incomplete'}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    top: 52,
    right: 90, // Next to Sensors button
    zIndex: 10,
    backgroundColor: '#fff',
    borderColor: '#e5e5e5',
    borderWidth: 1,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    maxWidth: 150,
  },
  buttonText: {
    color: '#333',
    fontSize: 12,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  closeText: {
    fontSize: 16,
    color: '#10b981',
    fontWeight: 'bold',
  },
  list: {
    padding: 16,
  },
  item: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  itemActive: {
    backgroundColor: '#f0fdf4', // emerald-50
    borderRadius: 8,
    paddingHorizontal: 12,
    marginHorizontal: -12,
    borderBottomWidth: 0,
    marginBottom: 8,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  itemTitleActive: {
    color: '#059669', // emerald-600
  },
  itemSubtitle: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
});
