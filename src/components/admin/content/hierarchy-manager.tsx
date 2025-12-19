'use client';

import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Pencil, Trash2, Image as ImageIcon } from 'lucide-react';
import type { Field, Classification, Course } from '@/lib/types';
import { useCollection, useFirestore } from '@/firebase';
import { collection, query, where, doc, addDoc, updateDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import HierarchyItemDialog, { type HierarchyItem } from './hierarchy-item-dialog';
import { deleteHierarchyItem } from '@/lib/actions/delete-hierarchy-item';
import ThumbnailEditorDialog from './thumbnail-editor-dialog';
import { cn } from '@/lib/utils';

type Item = (Classification | Course) & { type: 'classification' | 'course' };

const ItemCard = ({ item, onSelect, selected, onEdit, onDelete, onEditThumbnail }: {
  item: Item;
  onSelect: () => void;
  selected: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onEditThumbnail: () => void;
}) => (
  <Card 
    className={cn(
        "cursor-pointer transition-all",
        selected ? "border-primary shadow-md" : "hover:shadow-md hover:border-gray-300"
    )}
    onClick={onSelect}
  >
    <div className="relative aspect-video">
        <Image 
            src={item.thumbnailUrl}
            alt={item.name}
            data-ai-hint={item.thumbnailHint}
            fill
            className="object-cover rounded-t-lg"
        />
    </div>
    <CardContent className="p-3">
        <p className="font-semibold truncate" title={item.name}>{item.name}</p>
        <div className="flex justify-between items-center mt-2">
          <div className="space-x-1">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); onEdit(); }}><Pencil className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); onEditThumbnail(); }}><ImageIcon className="h-4 w-4" /></Button>
          </div>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(); }}><Trash2 className="h-4 w-4" /></Button>
        </div>
    </CardContent>
  </Card>
);

const Column = ({ title, items, children, onAdd }: {
    title: string;
    items?: any[];
    children: React.ReactNode;
    onAdd: (() => void) | null;
}) => (
    <div className="flex-1 min-w-[300px] bg-muted/50 p-4 rounded-lg">
        <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-lg">{title}</h3>
            {onAdd && <Button size="sm" onClick={onAdd}><Plus className="mr-2 h-4 w-4"/>추가</Button>}
        </div>
        <div className="grid grid-cols-1 gap-4 overflow-y-auto h-[60vh] p-1">
            {children}
        </div>
    </div>
);


type NameDialogState = {
  isOpen: boolean;
  item: HierarchyItem | null;
  type: '분야' | '큰분류' | '상세분류';
};
type ThumbnailDialogState = {
    isOpen: boolean;
    item: Classification | Course | null;
    type: 'classifications' | 'courses';
}

export default function HierarchyManager() {
  const firestore = useFirestore();
  const { toast } = useToast();

  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [selectedClassification, setSelectedClassification] = useState<string | null>(null);

  const [nameDialog, setNameDialog] = useState<NameDialogState>({ isOpen: false, item: null, type: '분야' });
  const [thumbnailDialog, setThumbnailDialog] = useState<ThumbnailDialogState>({ isOpen: false, item: null, type: 'classifications' });

  const fieldsQuery = useMemo(() => (firestore ? collection(firestore, 'fields') : null), [firestore]);
  const { data: fields, isLoading: fieldsLoading } = useCollection<Field>(fieldsQuery);

  const classificationsQuery = useMemo(() =>
    firestore && selectedField ? query(collection(firestore, 'classifications'), where('fieldId', '==', selectedField)) : null,
    [firestore, selectedField]
  );
  const { data: classifications, isLoading: classificationsLoading } = useCollection<Classification>(classificationsQuery);

  const coursesQuery = useMemo(() =>
    firestore && selectedClassification ? query(collection(firestore, 'courses'), where('classificationId', '==', selectedClassification)) : null,
    [firestore, selectedClassification]
  );
  const { data: courses, isLoading: coursesLoading } = useCollection<Course>(coursesQuery);
  
  useEffect(() => {
    if (selectedField && fields && !fields.find(f => f.id === selectedField)) {
      setSelectedField(null);
    }
  }, [fields, selectedField]);

  useEffect(() => {
    if (selectedClassification && classifications && !classifications.find(c => c.id === selectedClassification)) {
      setSelectedClassification(null);
    }
  }, [classifications, selectedClassification]);

  const handleSelectField = (id: string | null) => {
    setSelectedField(id);
    setSelectedClassification(null);
  };

  const handleSelectClassification = (id: string | null) => {
    setSelectedClassification(id);
  };

  const openNameDialog = (type: NameDialogState['type'], item: HierarchyItem | null = null) => {
    if ((type === '큰분류' && !selectedField) || (type === '상세분류' && !selectedClassification)) {
      toast({ variant: 'destructive', title: '오류', description: '상위 계층을 먼저 선택해주세요.' });
      return;
    }
    setNameDialog({ isOpen: true, item, type });
  };
  
  const openThumbnailDialog = (type: 'classifications' | 'courses', item: Classification | Course) => {
    setThumbnailDialog({ isOpen: true, item, type });
  }

  const closeDialogs = () => {
      setNameDialog({ isOpen: false, item: null, type: '분야' });
      setThumbnailDialog({ isOpen: false, item: null, type: 'classifications' });
  };

  const handleSaveName = async (item: HierarchyItem) => {
    if (!firestore) return;
    try {
      const { type, item: existingItem } = nameDialog;
      let collectionName: 'fields' | 'classifications' | 'courses';

      if (type === '분야') collectionName = 'fields';
      else if (type === '큰분류') collectionName = 'classifications';
      else collectionName = 'courses';

      if (existingItem) { // Edit mode
        await updateDoc(doc(firestore, collectionName, existingItem.id), { name: item.name });
        toast({ title: '수정 성공', description: `${type} '${item.name}'이(가) 수정되었습니다.` });
      } else { // Add mode
        let data: any = { name: item.name };
        if (type === '큰분류' && selectedField) {
          data.fieldId = selectedField;
           data.prices = { day1: 0, day30: 0, day60: 0, day90: 0 };
           data.description = "새로운 분류입니다.";
           data.thumbnailUrl = "https://picsum.photos/seed/default-class/600/400";
           data.thumbnailHint = "placeholder";
        } else if (type === '상세분류' && selectedClassification) {
          data.classificationId = selectedClassification;
          data.description = "새로운 강좌입니다.";
          data.thumbnailUrl = "https://picsum.photos/seed/default-course/600/400";
          data.thumbnailHint = "placeholder";
        }
        await addDoc(collection(firestore, collectionName), data);
        toast({ title: '추가 성공', description: `${type} '${item.name}'이(가) 추가되었습니다.` });
      }
    } catch (error) {
      console.error("Error saving document: ", error);
      toast({ variant: 'destructive', title: '저장 실패', description: '항목 저장 중 오류가 발생했습니다.' });
    } finally {
      closeDialogs();
    }
  };
  
  const handleDelete = async (collectionName: 'fields' | 'classifications' | 'courses' | 'episodes', id: string, name: string, itemData?: any) => {
    if (!firestore) return;
    if (!confirm(`정말로 '${name}' 항목을 삭제하시겠습니까? 하위 항목이 있는 경우 함께 삭제됩니다.`)) return;

    try {
        const result = await deleteHierarchyItem(collectionName, id, itemData);
        if (result.success) {
            toast({ title: '삭제 성공', description: result.message });
            if (collectionName === 'fields' && selectedField === id) {
                setSelectedField(null);
            }
            if (collectionName === 'classifications' && selectedClassification === id) {
                setSelectedClassification(null);
            }
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("Error during delete process:", error);
        toast({
            variant: "destructive",
            title: "삭제 중 오류 발생",
            description: errorMessage,
        });
    }
  };

  const renderSkeletons = () => (
    <div className="grid grid-cols-1 gap-4">
        {Array.from({length: 3}).map((_, i) => (
            <div key={i} className="rounded-lg border bg-card p-3 space-y-2">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-5 w-3/4" />
                <div className="flex justify-between">
                    <Skeleton className="h-7 w-16" />
                    <Skeleton className="h-7 w-7" />
                </div>
            </div>
        ))}
    </div>
  )


  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>콘텐츠 계층 관리 (카드 뷰)</CardTitle>
          <p className="text-sm text-muted-foreground">분야 &gt; 큰분류 &gt; 상세분류 순서로 콘텐츠 계층을 관리합니다. 카드를 클릭하여 하위 항목을 확인하세요.</p>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <Column title="분야 (Field)" onAdd={() => openNameDialog('분야')}>
                {fieldsLoading ? <Skeleton className="h-8 w-full" /> : 
                    <div className="flex flex-col gap-2">
                        {fields?.map(item => (
                            <div key={item.id} className={cn("flex items-center justify-between p-2 rounded-md cursor-pointer", selectedField === item.id ? 'bg-primary/10' : 'hover:bg-primary/5')} onClick={() => handleSelectField(item.id)}>
                                <span className={cn("font-medium", selectedField === item.id && "text-primary")}>{item.name}</span>
                                <div className="flex gap-2">
                                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); openNameDialog('분야', item); }}><Pencil className="h-4 w-4" /></Button>
                                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={(e) => { e.stopPropagation(); handleDelete('fields', item.id, item.name); }}><Trash2 className="h-4 w-4" /></Button>
                                </div>
                            </div>
                        ))}
                    </div>
                }
            </Column>
            <Column title="큰분류 (Classification)" onAdd={selectedField ? () => openNameDialog('큰분류') : null}>
                {!selectedField ? <p className="text-center text-sm text-muted-foreground">분야를 선택해주세요.</p> :
                 classificationsLoading ? renderSkeletons() :
                 classifications?.map(item => (
                     <ItemCard 
                        key={item.id}
                        item={{...item, type: 'classification'}}
                        selected={selectedClassification === item.id}
                        onSelect={() => handleSelectClassification(item.id)}
                        onEdit={() => openNameDialog('큰분류', item)}
                        onDelete={() => handleDelete('classifications', item.id, item.name)}
                        onEditThumbnail={() => openThumbnailDialog('classifications', item)}
                     />
                 ))
                }
            </Column>
            <Column title="상세분류 (Course)" onAdd={selectedClassification ? () => openNameDialog('상세분류') : null}>
                {!selectedClassification ? <p className="text-center text-sm text-muted-foreground">큰분류를 선택해주세요.</p> :
                 coursesLoading ? renderSkeletons() :
                 courses?.map(item => (
                    <ItemCard 
                       key={item.id}
                       item={{...item, type: 'course'}}
                       selected={false}
                       onSelect={() => {}} // Leaf node, no selection action
                       onEdit={() => openNameDialog('상세분류', item)}
                       onDelete={() => handleDelete('courses', item.id, item.name)}
                       onEditThumbnail={() => openThumbnailDialog('courses', item)}
                    />
                ))
                }
            </Column>
          </div>
        </CardContent>
      </Card>
      
      {nameDialog.isOpen && (
        <HierarchyItemDialog
          isOpen={nameDialog.isOpen}
          onClose={closeDialogs}
          onSave={handleSaveName}
          item={nameDialog.item}
          itemType={nameDialog.type}
        />
      )}

      {thumbnailDialog.isOpen && thumbnailDialog.item && (
        <ThumbnailEditorDialog
            isOpen={thumbnailDialog.isOpen}
            onClose={closeDialogs}
            item={thumbnailDialog.item}
            itemType={thumbnailDialog.type}
        />
      )}
    </>
  );
}
